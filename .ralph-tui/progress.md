# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

### Testing (US-001)
- Runner: **Vitest 4**, config in `vitest.config.mts` (`.mts`, not `.ts` — a `.ts`
  config is loaded as CJS and Vite warns about the ESM syntax in it).
- Tests live beside the code as `lib/**/*.test.ts`; only that glob is collected.
  Environment is `node`, globals are off — import `describe`/`it`/`expect` from
  `vitest`.
- The `@/` alias is mirrored from `tsconfig.json` into the Vitest `resolve.alias`,
  so tests import exactly like app code: `import { getConfig } from '@/lib/store'`.
- `tsconfig.json` includes `**/*.ts` and `**/*.mts`, so test files and the Vitest
  config are covered by `pnpm typecheck` for free — no separate tsconfig needed.
- Anything reading `.data/` (`getConfig`, `dataFile`) touches real local machine
  state, and `dataFile()` even creates the folder. Test pure helpers instead
  (`defaultConfig`, `normalizeRelPath`, `titleFromFileName`).

### Filesystem tests on a temp directory (US-002)
- Build the fixture in `beforeAll` with `fs.mkdtempSync(path.join(os.tmpdir(),
  'prefix-'))` and tear it down in `afterAll` with `fs.rmSync(dir, { recursive:
  true, force: true })`. Import `beforeAll`/`afterAll` from `vitest` — globals
  are off.
- **`os.tmpdir()` is a symlink on macOS** (`/var` -> `/private/var`). Path code
  that calls `fs.realpathSync` returns the resolved path, so assert against
  `fs.realpathSync(dir)`, never the string `mkdtempSync` returned.
- Lay out the fixture as `base/root/` with the "outside" files at `base/`, so a
  `..` escape targets a file that actually exists. Two sibling `mkdtemp` dirs
  make escape tests pass for the wrong reason (missing target, not refused).
- Mutation-check any test that asserts something is *refused*: flip the guard to
  `if (false && ...)`, re-run, confirm the test goes red, restore. A green suite
  against a disabled guard means the test proves nothing.

---


## 2026-08-19 - US-001 - Montar Vitest y el script test

Set up Vitest as the test runner for the project's pure logic, with a first
real test suite (11 tests) rather than a placeholder.

**What was implemented**
- `vitest@^4.1.11` added as a devDependency with pnpm.
- `package.json` scripts: `test` -> `vitest run` (non-interactive, CI/agent
  safe) and `test:watch` -> `vitest`.
- `vitest.config.mts`: `environment: 'node'`, `include: ['lib/**/*.test.ts']`,
  and a `resolve.alias` mapping `@` to the repo root to match `tsconfig.json`.
- `lib/transcripts.test.ts` covering `titleFromFileName` (extension stripping,
  leading-date removal, separator collapsing, date-only fallback) and
  `normalizeRelPath` (root spellings, absolute-looking paths read as
  root-relative, backslash normalization, trimming).
- `lib/store.test.ts` covering `defaultConfig` and asserting `getConfig` is
  importable through the `@/` alias.
- Test conventions documented in a new `## Tests` section in `AGENTS.md`.

**Files changed**
- `package.json`, `pnpm-lock.yaml` (vitest devDependency + scripts)
- `vitest.config.mts` (new)
- `lib/transcripts.test.ts`, `lib/store.test.ts` (new)
- `lib/transcripts.ts` (exported `titleFromFileName` and `normalizeRelPath`)
- `AGENTS.md` (`## Tests` section, appended below the generated block)

**Learnings**
- `titleFromFileName` and `normalizeRelPath` were module-private in
  `lib/transcripts.ts`; both had to be exported to be testable. They are pure,
  so exporting them costs nothing — but expect the same for other helpers in
  that file.
- `titleFromFileName('2026-08-09.md')` returns `'2026 08 09'`, not the raw
  stem: when stripping the leading date empties the string it falls back to the
  stem, and the fallback still runs the dash-to-space replacement. Non-obvious;
  the test pins it.
- `AGENTS.md` opens with a `BEGIN/END:nextjs-agent-rules` block that `next dev`
  rewrites on every run. Append project docs *below* the `END` marker; editing
  inside it just gets regenerated.
- Verify `pnpm test` really exits 0 and returns to the shell — the whole point
  of `vitest run` over `vitest` is not hanging in watch mode for an agent.

**Verification**
- `pnpm test` -> 2 files, 11 tests passed, exit code 0, no watch mode.
- `pnpm typecheck` -> passes (test files and `vitest.config.mts` included).

---

## 2026-08-19 - US-002 - Tests de la guarda de path traversal

Covered `resolveInsideRoot`, the only barrier between browser-supplied paths
and the filesystem, with 8 tests (19 total in the suite now) against a real
temp directory.

**What was implemented**
- A `describe('resolveInsideRoot')` block appended to `lib/transcripts.test.ts`:
  - normal relative paths (`notes.md`, `sub/nested.md`) resolve to the expected
    absolute path;
  - `''`, `'.'` and `'/'` all resolve to the root itself;
  - `../fuera.md`, `sub/../../fuera.md`, `../../fuera.md`, a five-deep `..`
    chain and a bare `..` throw `PathEscapesRootError`;
  - `/etc/passwd` is read as root-relative (`<root>/etc/passwd`) and never
    reaches the real file;
  - a symlink inside the root pointing outside throws; one pointing at another
    file inside the root resolves;
  - backslash paths normalize to `/` (`sub\nested.md` resolves, `..\fuera.md`
    throws);
  - missing paths (`missing.md`, `sub/deep/missing.md`) resolve without
    throwing — the ENOENT is the caller's to surface.
- `beforeAll` builds the fixture with `fs.mkdtempSync`, `afterAll` removes it
  with `fs.rmSync(..., { recursive: true, force: true })`.

**Files changed**
- `lib/transcripts.test.ts` (imports + new `resolveInsideRoot` suite).
  No production code was touched — `resolveInsideRoot` and
  `PathEscapesRootError` were already exported.

**Learnings**
- **`os.tmpdir()` is a symlink on macOS** (`/var` -> `/private/var`), and
  `resolveInsideRoot` realpaths the root before comparing. Asserting against the
  path `mkdtempSync` returned fails; every expectation has to go through
  `fs.realpathSync(root)`. Any future test that hands a temp dir to path code
  hits this.
- **Put the root *inside* a scratch dir, not at the top of it.** The first
  version made `root` and an `outside` sibling as two separate `mkdtemp` calls,
  so `../fuera.md` resolved to a path that did not exist — the test passed, but
  for the wrong reason (missing target, not refused escape). Layout is now
  `base/root/` with `base/fuera.md`, so `..` targets a file that really exists.
- **The lexical check in `resolveInsideRoot` is redundant.** Verified by
  mutation: disabling `if (!isInside(rootAbs, resolved))` alone keeps all 19
  tests green, because `realpath()` falls back to its input for missing paths,
  so the second check catches everything the first does. Disabling the realpath
  check alone fails 1 test; disabling both fails 3. It is defence in depth, not
  dead weight — but no test can pin it in isolation, and that is a property of
  the implementation, not a gap in the suite.
- **Mutation-check security tests before trusting them.** Flipping each guard
  to `if (false && ...)` and re-running took two minutes and is what caught the
  wrong-reason pass above. Worth doing for any test whose job is to prove
  something is refused.
- `fs.symlinkSync(target, linkPath)` takes the target first; a link created with
  the arguments swapped still "works" as a dangling link and the escape test
  silently passes on the ENOENT instead of the guard.

**Verification**
- `pnpm test` -> 2 files, 19 tests passed, exit code 0.
- `pnpm typecheck` -> passes.
- Mutation check: both guards disabled -> 3 failures; realpath guard disabled
  -> 1 failure. `lib/transcripts.ts` restored to a clean diff afterwards.

---
