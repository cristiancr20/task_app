# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

### Persisting a client hook's state (US-010)
Write-behind, not write-through. The pieces that make it safe are all in `lib/`
(and therefore tested); the hook is wiring:
- `lib/save-queue.ts` — debounce **per key**, and the key travels with the
  value. That single decision is what makes «a late save is written under the
  path it captured» true by construction rather than by a guard.
- Writes for one key are *chained*. Every save carries the whole state, so two
  overlapping requests leave whichever the server finished last on disk — not
  necessarily the newer one.
- Detect «worth saving» by fingerprinting the durable slice
  (`JSON.stringify({rows, baseline, extracted})`) in an effect over the whole
  state map, not by calling `save` from each mutation. Transient fields
  serialise identically, so a spinner or a dialog never reaches disk, and every
  future mutation is covered without being remembered. Side effects in a
  `setState` updater would run twice under StrictMode; an effect does not.
- Record the fingerprint of what a *load* returned before patching it in, or
  the load is written straight back out.

### A failed load must not become a write (US-010)
Keep a per-path «savable» set that a path only enters on a successful read (or
an extraction). Without it the empty table shown after a failed read is queued
over the drafts on disk — a read failure silently turned into data loss. Found
by driving the real UI with the route stubbed to 500, not by a test.
And when the retry *succeeds* with rows typed meanwhile, neither side is stale:
`mergeDrafts` keeps both. Choosing memory takes back curation the user never
saw; choosing disk takes back the row they just typed.

### Keys that outlive the page (US-010)
The moment a list is restored from disk, a `let sequence = 0` counter in module
scope is a bug: it re-issues keys that are already on screen, and one React key
for two rows means an edit lands on both. `lib/draft-ids.ts` reserves the
counter past whatever came back. Ids stay opaque on the wire — one it did not
mint (`row-2-b`, a uuid) restores under its own name instead of being renamed.

### Testing browser code when only `lib/**` is collected (US-010)
`vitest.config.mts` collects `lib/**/*.test.ts` in a `node` environment, so
nothing in `app/` is reachable and there is no DOM. Push every decidable piece
into `lib/` — the transport, the debounce, the merge, the key generator — and
leave the hook holding only React wiring. A `fetch` client is testable there:
`vi.stubGlobal('fetch', …)` returning a real `new Response(JSON.stringify(…))`,
`vi.unstubAllGlobals()` in `afterEach`. Timers too: `vi.useFakeTimers()` plus
`await vi.advanceTimersByTimeAsync(ms)`, which drains microtasks as it goes —
`advanceTimersByTimeAsync(0)` is the «let every promise settle» step.

### Sharing the atomic write (US-009)
The 0600 temp-file+rename write lives in `lib/atomic-write.ts` (`writeJsonFile`),
not in `lib/store.ts` — a second store gets the same guarantees for free.
Put it in its own module taking an **absolute path**, not in `lib/data-dir.ts`:
`store.test.ts` and `drafts-store.test.ts` both `vi.mock('@/lib/data-dir')`, so
a writer living there would be replaced by the mock and the mode assertions
would be testing the fixture instead of the code.

### Persisting per-note state (US-009)
`.data/drafts.json` is separate from `config.json` on purpose: drafts churn on
every edit, the config holds the API keys, and a corrupt draft file must never
be able to cost the user their keys.
Only persist what survives a reload. `generating` / `error` / `confirming`
describe a request in flight or a dialog on screen; restoring them would put a
spinner back for an extraction that ended hours ago. `normalizeState` picks the
three durable fields by name, so a client that sends the whole state object
cannot smuggle them in.
Route into the store through `normalizeState(payload)`: the `PUT` body then goes
through exactly the same sieve as a file already on disk, and `saveDrafts` keeps
a typed signature for internal callers.
Drop the key when a state has nothing to restore (no rows, no baseline, not
extracted) — `normalizeHistory` in `lib/store.ts` does the same with notes whose
entries were all discarded. `extracted: true` with zero rows is *not* empty: it
is «the model found none», which the table renders differently.

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

### Asserting file modes in a test (US-008)
- Compare in octal — `expect((mode & 0o777).toString(8)).toBe('600')`. A failure
  then reads `expected '644' to be '600'` instead of `420 to be 384`.
- Gate on `process.platform !== 'win32'` with `it.skipIf(!onPosix)`: on Windows
  the group/other bits are meaningless (`chmod` only moves the read-only flag),
  so the assertion would fail for a reason that is not a bug.
- To redirect a module-load-time constant derived from `process.cwd()` without
  `vi.mock`, stub and reload: `vi.resetModules()`, `vi.spyOn(process, 'cwd')
  .mockReturnValue(tempDir)`, then `await import('@/lib/data-dir')`. Pair it
  with `vi.restoreAllMocks()` in `afterEach`. Use this when the test needs the
  *real* module (here: to observe the mode `mkdirSync` actually applied), where
  the `vi.mock` of US-006 would replace the very code under test.

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

## 2026-08-19 - US-008

Restricted the on-disk permissions of the credentials the app stores.

- `lib/store.ts` — `writeConfig` creates the temp file with `mode: 0o600` and
  then `chmodSync`es it to `0600` before the rename, so `config.json` (which
  holds `claudeApiKey` / `linearApiKey`) ends up owner-only.
- `lib/data-dir.ts` — `ensureDataDir` creates `.data/` with `mode: 0o700`.
- `lib/store.test.ts` — new `describe('file permissions')`: the mode after a
  write, the narrowing of a file planted at `0644`, and the mode after
  `addHistoryEntry`. All three `skipIf(process.platform === 'win32')`.
- `lib/data-dir.test.ts` — new file; covers `ensureDataDir` (path, `0700`,
  idempotence) and `dataFile`, with `process.cwd` stubbed at a temp folder.

`pnpm typecheck` and `pnpm test` pass (170 tests, 5 files). There is no `lint`
script in `package.json` — `pnpm lint` resolves to the Android SDK's `lint`
binary on PATH, not a project check.

**Learnings:**
- `chmod` the *temp* file, never the target after the rename. Chmod'ing the
  target leaves a window where the keys are world-readable, and `rename` carries
  the temp file's mode over anyway — which is also what silently narrows a
  `config.json` an older version left at `0644`. The "pre-existing laxer file"
  criterion needs no extra code, but it does need its own test.
- `writeFileSync`'s `mode` only applies when the call *creates* the file, and is
  masked by the umask when it does; the explicit `chmodSync` is what makes the
  result deterministic.
- The existing `.data/` on a machine that predates this change keeps its old
  `0755` — `mkdirSync`'s `mode` only applies at creation. The config file inside
  it is narrowed on the next write, so the credentials are covered, but the
  folder itself is not retroactively fixed.
- Mutation check passed: dropping both `mode` options and the `chmodSync` turns
  exactly the 4 new tests red and leaves the other 166 green.

---

## 2026-08-19 - US-009
- Added `lib/drafts-store.ts`, the on-disk home of the task table's drafts:
  `.data/drafts.json`, keyed by the note's root-relative path exactly like
  `history`, holding `{ rows, baseline, extracted }` per note and nothing else.
  `getDrafts` / `saveDrafts` / `clearDrafts`; a missing, corrupt or partially
  malformed file yields empty state instead of throwing.
- Extracted the atomic owner-only write out of `lib/store.ts` into
  `lib/atomic-write.ts` (`writeJsonFile`), so both stores share one
  implementation of the temp-file + chmod 0600 + rename dance rather than a copy.
- Added `GET /api/drafts?path=…` and `PUT /api/drafts` with
  `{ path, rows, baseline, extracted }`, both guarded by `requireContextRoot()`,
  a `.md` check and `errorResponse` like every other route.
- Moved that `.md` check into `requireMarkdownPath()` in `lib/api.ts` and pointed
  `/api/transcript` and `/api/extract` at it — it was already copy-pasted twice.
- `lib/drafts-store.test.ts`: 52 tests over save/read round-trips, per-note keys,
  corrupt files, malformed rows, the transient fields, the 0600 mode and the
  atomic write. Suite is 222 tests; `pnpm typecheck` and `pnpm test` both green.
- Files changed: `lib/atomic-write.ts` (new), `lib/drafts-store.ts` (new),
  `lib/drafts-store.test.ts` (new), `app/api/drafts/route.ts` (new),
  `lib/store.ts`, `lib/api.ts`, `app/api/transcript/route.ts`,
  `app/api/extract/route.ts`.
- **Learnings:**
  - See the two new blocks in `## Codebase Patterns` — where the shared writer
    has to live so the `vi.mock('@/lib/data-dir')` fixtures do not swallow it,
    and which parts of `TaskDraftState` are worth persisting.
  - A row with no `id` is dropped rather than repaired: the id is the key the
    table edits and removes rows by, so a synthesised one would put something on
    screen the user could not get rid of. Everything else is coerced — an empty
    title is a row still being typed, not a broken one, and text is stored
    verbatim because trimming would move the caret of a draft mid-edit.
  - Mutation-checked three guards (id required, priority fallback, transient
    fields excluded): 4, 2 and 1 tests went red respectively, then restored.
  - Smoke-tested both routes against `pnpm dev`: a `PUT` carrying
    `generating`/`error`/`confirming` plus a priority of `"blocker"`, a numeric
    `mentioned` and an id-less row answered the sieved state, and
    `.data/drafts.json` landed as `-rw-------`. Scratch file removed afterwards.
---

## 2026-08-19 - US-010

The task table now survives a reload and a server restart.

- `app/use-task-drafts.ts` — the by-path map became a cache in front of
  `.data/drafts.json`. A note with no state in memory reads its drafts once on
  selection; every change to the rows is written back with a 500 ms debounce;
  the result of an extraction goes straight out through `saveNow`, baseline
  included. Two new fields on `TaskDraftState`, `loading` and `loadError`, and a
  `retryLoad` for the «Reintentar».
- `lib/save-queue.ts` (new) — the debounce. One pending value per key, the key
  captured with it, writes for a key chained, failures reported and dropped.
- `lib/drafts-client.ts` (new) — `fetchDrafts` / `saveDrafts` over the routes
  US-009 added, with the same «the route's Spanish travels verbatim» contract as
  every other client.
- `lib/drafts-merge.ts` (new) — what a note becomes when a read comes back: the
  stored state, or the table on screen when an extraction beat the read, or both
  when rows were typed into a table that could not be read.
- `lib/draft-ids.ts` (new) — row keys, reserved past the ones restored.
- `app/task-table.tsx` — a «Cargando tareas guardadas…» state instead of a false
  «Aún no hay tareas», and a warning strip with «Reintentar» above the table
  (never in place of it) when the read failed.

`pnpm typecheck` and `pnpm test` pass — 10 files, 303 tests, 55 of them new.
Seven mutations run against the new modules (reserve disabled, debounce removed,
chaining removed, shape check removed, and the three `mergeDrafts` branches);
every one turned tests red, and the files were restored afterwards.

**Verified in the browser**, against `pnpm dev` and a real context folder:
- Typing a 27-character title costs **one** `PUT`, not 27 — one `GET` on
  selection, one `PUT` per settled burst.
- Title, description, priority and the «incluir» checkbox come back byte for
  byte after `reload`, and again after killing and restarting `next dev`.
- «1 cambio manual» reads the same before and after a reload, because the
  baseline is stored with the rows.
- A real Ollama extraction (`qwen3:8b`) wrote `rows`, `baseline` and
  `extracted` in one go, ~20 s in; a run that found nothing persisted
  `extracted: true` with no rows, and the note still says «No se encontraron
  tareas» after a reload rather than «Aún no hay tareas».
- With the `GET` stubbed to 500: the notice appears, the table stays editable,
  and **nothing is written**. With the `PUT` stubbed to 500: the edit stands,
  the console names the note, and the next edit saves the text the failed one
  was carrying.
- `.data/drafts.json` stayed `-rw-------`. The scratch file was removed
  afterwards; `config.json` was never touched.

**Learnings:**
- See the four new blocks in `## Codebase Patterns`.
- **The bug the unit tests could not have found.** «Retry after a failed load»
  looked finished — the notice appeared, memory was preserved — until the
  browser showed the retry writing the one row typed during the outage *over*
  the two rows on disk. Marking a path savable is not the same as knowing its
  state came from disk. Fixed by `mergeDrafts`, whose three branches then went
  into `lib/` precisely so they could be tested and mutation-checked.
- The colliding-key case is not hypothetical: the row typed while the read was
  failing really did come out as `row-2`, the same key a stored row held, since
  the page had no way to know what was on disk. It is on the merge to part them.
- React 19's StrictMode double-invokes state updaters in dev, so `addRow`
  consumes two ids and the numbering skips. Harmless — they only have to be
  unique — but it is why an id-per-row counter must never be treated as a count.
- `playwright-cli` has no `network` command in 0.1.13 (it prints help). The
  request count that mattered came from the `next dev` log instead, which is
  better evidence anyway: it is the server saying what it received.
- Element refs go stale when an `aria-label` changes — `uncheck e242` silently
  did nothing after the row's label picked up the title that had just been
  typed. Re-snapshot and re-resolve the ref after any edit that changes a label.

---
