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
