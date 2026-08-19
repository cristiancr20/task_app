# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

### Verifying what a server binds to (US-007)
`lsof -nP -iTCP:<port> -sTCP:LISTEN` is the ground truth: `*:3300` means every
interface, `127.0.0.1:3300` means loopback only. Next's startup banner prints a
`Network:` line either way — bound to loopback it just repeats `127.0.0.1`, so
"the Network line is gone" is the wrong assertion; "the LAN IP is absent" is
the right one.
Prove the refusal against a real interface: take the address from `ipconfig
getifaddr en0` and curl it (connection refused is curl exit 7). A hardcoded or
fictional IP yields the same exit code while proving nothing.

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
- ### Testing pure normalisers (US-004)
- Drive `it.each` off the exported constant (`PRIORITIES`) instead of a hardcoded
- copy, so the test enumerates the contract rather than duplicating it.
- Use a local `row(overrides)` / `meta(overrides)` builder returning a valid
- object, so each test varies only the field it is about. Spreading
- `{ ...defaults, field: undefined }` is how you test "undefined"; use object
- destructuring (`const { title: _t, ...rest } = row()`) for "key absent".
- For a normaliser, the realistic bad input is the *neighbouring API's* encoding,
- not a typo: Linear's priority scale is numeric, so `priority: 1` is the case
- that happens in production. Test it alongside `'blocker'`.
- A shared coercion helper (`text()`) makes "wrong type" and "empty" the same
- code path — pin both directions, since dropping the scalar branch turns a
- numeric title into a *discarded row*, not merely a wrong string.
- Mutation-check any test that asserts something is *refused*: flip the guard to
  `if (false && ...)`, re-run, confirm the test goes red, restore. A green suite
  against a disabled guard means the test proves nothing.

### Redirecting `.data/` in a test (US-006)
- `DATA_DIR` is `process.cwd() + '/.data'`, frozen at module load, so an env var
  set inside the test is too late — replace the module:
  `vi.mock('@/lib/data-dir', async () => { ... mkdtempSync ... })`. The factory
  runs once, before the module under test is imported.
- Have the factory return `DATA_DIR` and import it back in the test
  (`import { DATA_DIR } from '@/lib/data-dir'`) instead of keeping a second copy
  of the path — the fixture and the code under test can then never disagree.
- Mock `@/lib/data-dir` even though `lib/store.ts` imports `'./data-dir'`:
  Vitest keys mocks by resolved path, and both specifiers resolve to the same
  file.
- `beforeEach` should empty the folder rather than re-create it, so the path in
  the already-loaded mock stays valid across tests.
- Guard against the test silently hitting the real folder: assert
  `readdirSync(DATA_DIR)` and check the real `.data/config.json` mtime is
  unchanged after the run.

---

### HTTP clients: stubbing fetch (US-005)
- Replace the global with `vi.stubGlobal('fetch', async (input, init) => ...)`
  and undo it in `afterEach(() => vi.unstubAllGlobals())`. Import `vi` from
  `vitest` — globals are off.
- Return a **real `Response`** (`new Response(JSON.stringify(body), { status })`)
  instead of a hand-rolled `{ ok, status, json }`. `ok` then derives from the
  status exactly as in production, and a malformed-body test is just a
  non-JSON string.
- Make the stub a **function of the call**, not a queue: `stubFetch((call, i) =>
  ...)` can answer the same page forever, which is what a "cursor that never
  advances" test needs. Have it push each decoded call
  (`JSON.parse(init.body)` -> `{ query, variables, headers }`) into an array it
  returns, so assertions read `calls[0].variables`.
- Assert on the **request** and not only the response for anything that shapes
  the payload: that a field is *omitted* (`expect(input).not.toHaveProperty(
  'projectId')`) is invisible from the return value.
- Tell the two queries of a paginated client apart by their operation name
  (`call.query.includes('query Teams(')`), not by call order — the order
  changes as soon as pagination does.
- A module-level cap that is not exported (`MAX_PAGES`) still gets pinned:
  mirror it as a const in the test with a comment, assert the exact call count,
  and a mutation of the real one goes red.

---

### Parsing/frontmatter fixtures (US-003)
- The `yaml` package parses on the **core schema**: `date: 2026-08-09` comes back
  a **string**, not a `Date`. The only spelling that yields a real `Date` is the
  explicit tag `date: !!timestamp 2026-08-09`. Any test for the `instanceof Date`
  branch of a date normalizer has to use the tag, or it silently tests the string
  branch instead.
- Write a real BOM into the fixture as the JS escape `'\ufeff'` — pasting the
  invisible character into the source works but is unreviewable in a diff.
- `fs.readdirSync(dir, { withFileTypes: true })` uses **lstat** semantics: a
  symlink entry answers `isSymbolicLink()`, and `isFile()` is `false`. Code
  gated on `entry.isFile()` therefore skips symlinked `.md` files entirely.
- To exercise an "unreadable file" branch, `fs.chmodSync(file, 0o000)` is the
  only reliable trick — a dangling symlink never reaches the read. It is a no-op
  for root, so gate the test with `it.skipIf(process.getuid?.() === 0)` and
  `chmod 0o600` back in `afterAll` before `rmSync`. Assert inside the test that
  `readFileSync` really throws, so it cannot pass vacuously.

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

## 2026-08-19 - US-003 - Tests del scanner de transcripciones

Covered `readTranscript` and `listFolder` — the parsing layer that decides what
metadata the model ever sees — with 14 tests (33 total in the suite now) against
a temp directory whose fixtures the test writes itself.

**What was implemented**
- `describe('readTranscript')` in `lib/transcripts.test.ts`, over a fixture
  folder written in `beforeAll`:
  - valid frontmatter: `title`, `date` (winning over the filename date) and a
    YAML list of `attendees` are read, `hasFrontmatter` is true, and the body
    comes back with the `---` block gone;
  - `words`/`approxTokens` are counted over the body only, not the frontmatter;
  - `attendees: Ana, Beto , Carla` on one line yields the same array as the list;
  - malformed YAML (`title: [sin cerrar`) does not throw: `hasFrontmatter` is
    false, metadata falls back to the filename, and the block stays in the body;
  - a scalar frontmatter and a sequence frontmatter both give
    `hasFrontmatter: false`;
  - no frontmatter at all: `2026-08-09 Weekly sync.md` gives title `Weekly sync`
    and date `2026-08-09`;
  - `date: !!timestamp 2026-03-04` (a real `Date` after parsing) normalizes to
    `2026-03-04`, and a string ISO timestamp keeps only its date part;
  - a leading BOM does not hide the frontmatter, and is stripped from the body.
- `describe('listFolder')`, over a second fixture folder:
  - only `.md` files are listed; `.oculto.md`, `notas.txt`, `README`,
    `node_modules/` and `.git/` are all left out;
  - no recursion: `sub` is offered as a folder, `sub/profundo.md` is not in the
    parent listing but is reachable one level down;
  - `relPath` is prefixed with the listed folder;
  - ordering is date descending, then title, with undated files last;
  - a `chmod 000` file is skipped without breaking the rest of the folder;
  - the empty path lists the root itself.

**Files changed**
- `lib/transcripts.test.ts` (imports + two new suites). No production code was
  touched: `readTranscript` and `listFolder` were already exported.

**Learnings**
- **`yaml` parses on the core schema, so `date: 2026-08-09` is a string.** The
  `input instanceof Date` branch of `toIsoDate` is only reachable through the
  explicit `!!timestamp` tag. The first draft of that test used a bare date and
  passed — through the string branch, proving nothing about the Date branch.
  Confirmed by mutation: disabling the `instanceof Date` branch now fails.
- `readdirSync(..., { withFileTypes: true })` is lstat-based, so the
  `entry.isFile()` gate in `listFolder` silently drops symlinked `.md` files.
  Worth knowing before writing a fixture that leans on symlinks.
- `chmod 000` is the only way to reach the `try/catch` around `readFileSync` —
  a dangling symlink is filtered out by `isFile()` first. It does nothing for
  root, hence `it.skipIf`, and it has to be chmodded back before `rmSync`.
- **Mutation-checked all ten guards this suite exists to pin** (dotfile/
  `node_modules` skip, `isRecord`, BOM strip, the unreadable-file `catch`, the
  Date branch, the comma split, `isMarkdown`, the sort, the undated-last rule,
  and the malformed-YAML `catch`). Every one produces at least one red test;
  no assertion in the suite is decorative.

**Verification**
- `pnpm test` -> 2 files, 33 tests passed, exit code 0.
- `pnpm typecheck` -> passes.
- Ten mutations run against `lib/transcripts.ts`, each caught (1-3 failures);
  file restored to a clean diff afterwards (`git status` clean for it).

---
## 2026-08-19 - US-004
Covered `normalizeTasks` and `buildUserPrompt` in `lib/extractors/task.ts` — the
last layer between a local model's answer and both the table and Linear — with
56 tests (89 total in the suite now). Pure logic, no fixtures needed.

**What was implemented**
- `lib/extractors/task.test.ts`, with two local builders so each test varies only
  the field it is about: `row(overrides)` (a well-formed raw task) and
  `meta(overrides)` (a `TranscriptMeta`).
- `normalizeTasks: the shape of the payload`
  - the `{ tasks: [...] }` wrapper and a bare array at the root both work;
  - `{ tasks: ... }` that is an object / string / null is treated as no tasks;
  - nine off-contract payloads (`null`, `undefined`, string, `''`, number,
    boolean, object without `tasks`, `{}`, `[]`) each give `[]` and are asserted
    not to throw;
  - non-object rows (`null`, string, number, `[]`, `undefined`) are dropped
    individually without taking the valid rows around them down.
- `normalizeTasks: the title decides whether a row survives`
  - no `title` key at all, `''`, `'   '`, `'\t\n '`, `null`, `undefined`, an
    object and an array all discard the row; a valid title comes back trimmed.
- `normalizeTasks: priority`
  - all five levels of `PRIORITIES` are preserved (driven off the exported
    constant, so a sixth level cannot be added without the test noticing);
  - `blocker`, `urgente`, `null`, `undefined`, `''`, `'   '`, an object and an
    array all fall back to `none`;
  - the numeric levels `0..4` — Linear's own scale, what a model reaches for
    when it ignores the enum — also fall back to `none`;
  - `HIGH`, `Urgent` and `'  MeDiUm  '` normalize to the lowercase level.
- `normalizeTasks: mentioned` — missing, `null`, `''`, spaces and an object give
  `null`; a name comes back trimmed.
- `normalizeTasks: non-string scalars` — a numeric title keeps the row (as
  `'2026'`), numbers/booleans in `description`/`evidence`/`mentioned` are
  stringified, non-scalars empty the field, and keys beyond the contract
  (`dueDate`, `assigneeId`) do not survive into the returned object.
- `buildUserPrompt` — date and attendees appear when present, each line is
  omitted independently when absent, only `Title:` remains when both are
  missing, and the transcript is trimmed before the closing instruction.

**Files changed**
- `lib/extractors/task.test.ts` (new). No production code touched:
  `normalizeTasks`, `buildUserPrompt` and `PRIORITIES` were already exported.

**Learnings**
- **`it.each` over the exported `PRIORITIES` constant** beats hardcoding the five
  strings: the test enumerates the contract rather than a copy of it.
- The interesting invalid priority is a *number*, not a typo. Linear's API scale
  is numeric (1 = urgent), so `priority: 1` is the realistic bad answer, and
  `text()` stringifies it to `'1'` — which is exactly why the whitelist check
  after it matters. A suite that only tests `'blocker'` misses the case that
  actually happens.
- `text()` doing double duty (trim + stringify scalars) means "numeric field"
  and "empty field" are the same code path; both directions need pinning, since
  removing the scalar branch turns a numeric title into a *dropped row*, not a
  wrong string.
- **Mutation-checked all 13 guards** this suite exists to pin: bare-array accept,
  the non-object payload guard, `Array.isArray(tasks)`, the non-object row guard,
  the empty-title drop, `.toLowerCase()`, the `PRIORITIES` whitelist,
  `text(mentioned) || null`, the number/boolean branch of `text`, `.trim()`, and
  the three `buildUserPrompt` conditionals (date, attendees, transcript trim).
  Each produces 1-9 red tests; no assertion is decorative.

**Verification**
- `pnpm test` -> 3 files, 89 tests passed, exit code 0.
- `pnpm typecheck` -> passes.
- 13 mutations run against `lib/extractors/task.ts`, each caught; file restored
  (`git diff lib/extractors/task.ts` empty afterwards).
- Note: **there is no `lint` script in `package.json`** — `pnpm lint` falls
  through to an unrelated `lint` binary on PATH (Android's) and its help text is
  not a passing lint run. The gates in this repo are `typecheck` and `test`.

---

## 2026-08-19 - US-005 - Tests del cliente de Linear

Covered the Linear client's parsing and payload building with 40 tests, all
against a stubbed `fetch` — no request leaves the process and no real workspace
is touched.

**What was implemented**
- `lib/linear.test.ts`, with a `stubFetch(reply)` helper that swaps the global
  via `vi.stubGlobal`, records every decoded request, and answers with a real
  `Response`.
- `buildIssueDescription`: body returned untouched with no source; the full
  block emitting `---`, `**Source:** <title> — <date>`, `**Mentioned:**` and the
  evidence as a blockquote; a multi-line quote prefixed `>` on every line; an
  all-blank source appending nothing; the date-only fallback title.
- `createIssue`: the five priorities against Linear's scale
  (urgent=1, high=2, medium=3, low=4, none=0) driven off an `it.each` table, the
  default when none is given, `projectId`/`parentId` sent trimmed when present
  and absent from the payload for null/undefined/empty/blank, a 200 carrying
  `success: false` rejected, and empty team/title refused *before* any request.
- `listTeamsAndProjects`: both cursors followed to exhaustion with the result
  aggregated and sorted by name, no extra request when projects fit one page,
  and a non-advancing cursor cut at MAX_PAGES on the teams loop and on the
  projects loop.
- `linearGraphQL`: the key sent bare in `Authorization`, 401 -> 401, 400 with
  errors -> 502 keeping Linear's message, HTTP status reported when the body has
  no errors, errors on a 200 surfaced, a rejecting fetch -> `LinearUnreachableError`,
  and an empty key refused without touching the network.

**Files changed**
- `lib/linear.test.ts` (new). `lib/linear.ts` untouched.

**Learnings:**
- A `Response` built with the `Response` constructor is the least-effort stub
  and the most faithful one; `ok` is derived, so a wrong-status test cannot pass
  by accident.
- **`{ success: false, issue: null }` is a fixture that tests nothing.** The
  first version of the success-flag test stayed green with the guard replaced by
  `if (false)`, because `readIssue(null)` throws the *next* `LinearApiError`,
  also a 502. The fixture needs a **valid issue node** so the flag is the only
  thing that can refuse it — and the assertion should pin the message, since two
  different guards share the status.
- Mutation-checked the whole file: disabling the success guard, flattening
  `statusFor` to always 502, always sending `projectId`, mapping `urgent` to 2,
  moving `MAX_PAGES` to 25, and quoting the evidence without splitting lines —
  each turns the suite red (1-2 tests). Restore from a copy taken beforehand and
  confirm `git diff` on the source is empty.
- `AbortSignal.timeout(15_000)` in the code under test does not keep Vitest
  alive; the whole suite still finishes in ~300ms.

---

## 2026-08-19 - US-006 - Tests del store de configuración

Covered `lib/store.ts` end to end — read, normalisation, atomic write — with 41
tests running against a temp `.data/`, so the developer's real config is never
read nor written.

**What was implemented**
- `lib/store.test.ts` rewritten. `vi.mock('@/lib/data-dir', ...)` replaces the
  module with one whose `DATA_DIR` is a fresh `mkdtempSync` folder; the test
  imports `DATA_DIR` back from the mock so both sides name the same directory.
  `beforeEach` empties the folder, `afterAll` removes it.
- `getConfig`: missing file, invalid JSON, empty file, and a root that is an
  array / string / null all yield the defaults.
- Wrong types: `recentFolders` as a string and `history` as an array fall back
  to `[]` / `{}` while the valid `contextRoot`, `ollamaModel`, `linearApiKey`
  and `lastProjectId` around them survive; non-string members inside
  `recentFolders` are dropped; `contextRoot` / `lastProjectId` null out.
- `provider`: unknown name, empty string, number and absent all fall to
  `'ollama'`; `'claude'` is kept, so the fallback is not just a constant.
- History normalisation: an entry without `pushedAt`, with a non-string
  `pushedAt`, without `issues`, with a non-array `issues`, or that is not an
  object is discarded; the note key disappears when every entry goes; an entry
  with an *empty* issues array is kept; a malformed issue is dropped without
  taking its entry with it.
- `updateConfig` merges over what is stored, persists, writes a complete config
  from nothing, normalises the merge (a bad partial cannot poison the file) and
  rebuilds from defaults over a corrupt file.
- `addHistoryEntry` appends most-recent-last across three pushes, keeps notes on
  separate keys, persists, refuses a malformed entry without losing the previous
  ones, and leaves the rest of the config alone.
- `getPushSummaries`: totals issues across pushes with the last timestamp, omits
  a note whose pushes created no issue, summarises notes independently, and
  still counts an empty push when the note produced issues elsewhere.
- The atomic write: `readdirSync(DATA_DIR)` equals exactly `['config.json']`
  after three writes, and the file is pretty JSON ending in a newline.

**Files changed**
- `lib/store.test.ts` (rewritten). `lib/store.ts` untouched.

**Learnings:**
- `pnpm test` -> 4 files, 163 tests passed. `pnpm typecheck` passes. `.data/`
  kept its original mtime throughout.
- 14 mutations run against `lib/store.ts`, every one caught; `git diff
  lib/store.ts` empty afterwards.
- **Check that a mutation actually applied.** The first `updateConfig`-skips-
  `normalize` run came back green — the regex had said `return normalize(` when
  the source says `const next = normalize(`, so nothing was patched. A green
  mutation run means "the test is weak" *or* "the edit missed"; print
  `git diff --stat` on the file next to the result to tell them apart.

---
## 2026-08-19 - US-007

Bound the dev and production servers to the loopback interface so the app is
not reachable from the LAN.

- `package.json`: `dev` is now `next dev -H 127.0.0.1 -p 3300` and `start` is
  now `next start -H 127.0.0.1 -p 3300`. Next's default is `0.0.0.0`, confirmed
  in `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md` for
  both subcommands.

**Verified**
- Before the change the running server showed `TCP *:3300 (LISTEN)` in `lsof`
  — every interface. After it, `TCP 127.0.0.1:3300 (LISTEN)`.
- `pnpm dev` and `pnpm start` (against a real `pnpm build`) both: `curl
  localhost:3300` -> 200, `curl 127.0.0.1:3300` -> 200, `curl
  192.168.1.4:3300` (the machine's LAN IP) -> connection refused, curl exit 7.
- Neither banner contains `192.168.` anywhere.
- `pnpm typecheck` passes; `pnpm test` -> 4 files, 163 tests passed.

**Files changed**
- `package.json` (two script lines). No source or test changes.

**Learnings:**
- **Next still prints a `Network:` line when bound to loopback** — it just
  reads `http://127.0.0.1:3300` instead of the LAN IP. Do not assert that the
  word `Network` disappeared; the check that means something is that the LAN IP
  is absent from the output (`grep 192.168.`), backed by the bind address in
  `lsof`.
- **Assert the bind address, not just the banner.** `lsof -nP -iTCP:3300
  -sTCP:LISTEN` prints `*:3300` for a wide-open server and `127.0.0.1:3300` for
  a loopback one — that is the ground truth the banner only summarises.
- **A negative network test needs the interface to exist.** Curling the LAN IP
  proves refusal only because `ipconfig getifaddr en0` returned a real address
  the machine is actually up on; against a made-up IP the same exit 7 would
  prove nothing. Resolve the IP at test time, do not hardcode it.
- **Gotcha: `next dev` refuses to start if another dev server is already
  running** for the same directory, printing `Another next dev server is
  already running` with the PID *after* printing its own ready banner. The
  first run of the new script looked like it worked and then exited 1 — the
  pre-existing server (started with the old, `0.0.0.0` script) was still
  holding the port. Kill the old PID before verifying, or the socket you
  inspect is the old binding.
- `next build` writes `.next` while `next dev` writes `.next/dev`, so a
  production build can be run without disturbing a running dev server.

---
