# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

- **Typecheck must run `next typegen` first.** Next 16 generates route/layout types
  (`LayoutProps`, `PageProps`, …) into `.next/dev/types`, which `tsconfig.json` includes.
  Running bare `tsc --noEmit` on a clean checkout fails with
  `TS2304: Cannot find name 'LayoutProps'`. The script is
  `next typegen && tsc --noEmit` — this is the pattern documented in
  `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`.
- **Local state lives in `.data/`.** Use `lib/data-dir.ts`: `DATA_DIR`,
  `ensureDataDir()`, and `dataFile(name)` (which ensures the folder then returns the
  path). Never hardcode `.data` paths elsewhere.
- **Server startup hook is `instrumentation.ts`** (`register()`, runs once per server
  instance). Guard node-only work with `process.env.NEXT_RUNTIME !== 'nodejs'` and
  `await import(...)` the node module so it is not bundled for the edge runtime.
- Read `node_modules/next/dist/docs/` before writing Next-specific code — this Next
  version differs from training data.
- **Persisted state goes through `lib/store.ts`, never `fs` directly.** `getConfig()`,
  `updateConfig(partial)`, `addHistoryEntry(relPath, entry)`, `getHistory(relPath)`.
  Reads are total (a missing/malformed/partially-corrupt file yields defaults, never
  throws) and writes are atomic (temp file + `renameSync` in the same folder). The
  store is sync and node-only — import it from route handlers / server components,
  not from client components.
- **All filesystem access under `contextRoot` goes through `lib/transcripts.ts`.**
  `resolveInsideRoot(root, relPath)` is the *only* place request input becomes a path —
  never build one with `path.join` at a call site. `listFolder(root, relPath)` and
  `readTranscript(root, relPath)` call it for you. `relPath` is always root-relative and
  `/`-separated (`''` = root); a leading `/` is stripped (URL-style), so an absolute path
  misses with ENOENT instead of escaping. Also sync and node-only.
- **Route handlers share `lib/api.ts`, they do not hand-roll error handling.**
  `requireContextRoot()` (400 when unset), `pathParam(request)` (the `?path=` query,
  trimmed, `''` = root), `jsonError(status, message)` and
  `errorResponse(err, relPath)` — the single place that maps a thrown error to a
  status: `HttpError` → its own status, `PathEscapesRootError` → 400, `ENOENT` → 404,
  `ENOTDIR`/`EISDIR`/`ENAMETOOLONG` → 400, `EACCES`/`EPERM` → 403, anything else →
  logged + 500. The body is always `{ error: string }` on failure. Throw
  `new HttpError(status, message)` for route-specific rejections rather than
  building a `Response` inline.
- **API error messages are user-facing Spanish** — the UI shows them inline
  (PRD: "UI copy in Spanish"). Data returned by the routes is not translated.
- **`describeError(err, relPath)` is the error mapping; `errorResponse` only wraps it.**
  Route handlers keep using `errorResponse`; anything that is not a route (Server
  Actions, which answer with state) calls `describeError(...).message` so both paths
  produce the same Spanish text.
- **Settings mutations are Server Actions, not `/api` routes.** `app/settings/actions.ts`
  is `'use server'`; the page is a server component reading `getConfig()` with
  `export const dynamic = 'force-dynamic'`, and the form is a client component using
  `useActionState`. After a successful mutation the action calls `refresh()` from
  `next/cache` so the page re-renders with the new config. Note a `'use server'` file may
  only export **async functions** — put initial state and constants elsewhere.
- **Changing `contextRoot` goes through `openContextRoot(input)` in `lib/context-root.ts`.**
  It normalizes (trim, `~` expansion, `path.resolve`), verifies the folder with
  `fs.opendirSync` (ENOENT / ENOTDIR / EACCES in one call) and only then persists both
  `contextRoot` and the `recentFolders` list (most recent first, deduped,
  `MAX_RECENT_FOLDERS = 8`). Never set `contextRoot` with `updateConfig` directly.
- **All Ollama traffic goes through `lib/ollama.ts`.** `OLLAMA_URL` (env `OLLAMA_URL`,
  default `http://127.0.0.1:11434`), `DEFAULT_OLLAMA_MODEL` and `listOllamaModels()`,
  which throws `OllamaUnreachableError` when the server is down and returns `[]` when it
  is up with nothing pulled — two different states the UI must tell apart. The error is
  mapped to a 503 + Spanish message in `describeError`, like every other failure.
- **Secrets stored in the config are write-only from the browser.** The server component
  passes `hasClaudeApiKey`/`hasLinearApiKey` booleans, never the key; the input shows a
  masked placeholder, an empty submit keeps the stored value, and a «Borrar» submit
  button (`name="intent"`) is what erases it.
- **All Linear traffic goes through `lib/linear.ts`.** `linearGraphQL(apiKey, query, vars)`
  is the single request helper (personal API keys go in `Authorization` *without* a
  `Bearer` prefix) and `fetchLinearOrganization(apiKey)` is the workspace lookup behind
  «Probar». `LINEAR_API_URL` is overridable by the env var of the same name so the app
  can be pointed at a stub. Failures split in two: `LinearUnreachableError` (network,
  → 503) and `LinearApiError` (Linear answered and refused; carries the status our
  routes should return — 401 for the whole auth range, 502 otherwise).
- **A remote API's own error text is passed through, not translated.** Only Linear knows
  whether a key is invalid, revoked or short a permission, so `describeError` forwards
  its English message prefixed with `Linear: `. Our Spanish copy covers what *we* know
  (no key stored, no connection).
- **Anything checking a stored secret is a `GET` route that reads it server-side.** The
  browser triggers `/api/linear/verify` and reads back only the workspace name — the key
  is never in a URL, a query string or a request body. The «Probar» button therefore
  tests what is *stored*, and stays disabled while the input holds unsaved text.
- **Drive the dev server at `http://localhost:3300`, never `127.0.0.1`.** Next 16 blocks
  cross-origin dev resources by default, so `127.0.0.1` gets the JS chunks refused and
  the page never hydrates — every click silently does nothing and the failure looks like
  a bug in the component.
- **The explorer browses from the client, through `lib/browse-client.ts`.**
  `fetchFolder(relPath)` calls `GET /api/browse` and throws an `Error` carrying the
  route's own Spanish message; `useFolderListings()` (`app/use-folder-listings.ts`) is
  the cache on top of it — `states[relPath]` is `loading | ready | error`, `open()`
  fetches a folder at most once, `reload()` forces a refetch behind «Reintentar». One
  listing feeds both panels (the tree reads `folders`, the list reads `files`), so a
  folder is never fetched twice.
- **A client module may use the scanner's types, never its code.** `lib/transcripts.ts`
  imports `node:fs`, so client components take `import type { … }` from it — erased at
  compile time. `pnpm build` is the check: its fs-tracing warnings print import traces,
  and a Client Component trace appearing there means node code leaked into the bundle.
- **Full-height views need a definite height, not `flex-1`.** `body` is
  `min-h-full flex flex-col`, so a `flex-1` child is sized by its content and
  `overflow-y-auto` inside it never scrolls — the page grows instead. Views with
  independently scrolling panels set `h-dvh` on their root (see `app/page.tsx`).
- **Markdown is parsed by `lib/markdown.ts` and rendered by `<Markdown>`
  (`app/markdown.tsx`).** `parseMarkdown(source)` returns a tree of plain data and the
  component turns every node into a React element, so nothing from a transcript is ever
  inserted as HTML and `dangerouslySetInnerHTML` appears nowhere. `safeHref` drops any
  scheme that is not `http(s)`/`mailto`/relative (a `javascript:` link degrades to its
  own text). Supported: headings, lists (nested), quotes, fences, rules, and inline
  code/emphasis/strikethrough/links/autolinks. Not supported, on purpose: tables,
  reference links, footnotes and raw HTML, which show up as plain text.
- **Reading a file goes through `lib/transcript-client.ts` + `useTranscript()`.**
  `fetchTranscript(relPath)` calls `GET /api/transcript` (same Spanish-message contract
  as `fetchFolder`) and `useTranscript(relPath)` (`app/use-transcript.ts`) reloads on
  every selection change. Unlike `useFolderListings` it deliberately does **not** cache:
  the response carries the file's push history, which changes while the page is open.
- **`GET /api/transcript` answers `{ meta, body, history }`.** The already-processed
  notice is keyed by the very path being read, so the history rides along with the
  transcript instead of costing a second round trip.
- **Everything both extractors must agree on lives in `lib/extractors/task.ts`.**
  The `ExtractedTask` type, `PRIORITIES`, `TASKS_JSON_SCHEMA` (the structured-output
  contract), `SYSTEM_PROMPT`, `buildUserPrompt(transcript, meta)` and
  `normalizeTasks(payload)`. A provider module (`./ollama`, `./claude`) only owns its
  HTTP; it never writes its own prompt or schema, so a task from either one is
  indistinguishable. The schema stays inside the subset *both* APIs accept: object at
  the top level (a bare array is rejected by Anthropic), every property `required`,
  `additionalProperties: false`, and nullability as `type: ['string', 'null']` rather
  than `anyOf`.
- **Structured output constrains shape, not content — `normalizeTasks` makes the
  guarantees.** Empty titles dropped, unknown/missing priority → `'none'`, blank
  `mentioned` → `null`, non-strings coerced. It also accepts a bare array, which models
  answer with despite the schema. An empty result is a *valid* answer (a transcript
  with no commitments), so it never throws — callers that need to tell "no tasks" from
  "no answer" check the parse instead.
- **Extractor failures throw `ExtractionError` (from `lib/extractors/task.ts`) and
  `describeError` maps it to 502.** Its message is already user-facing Spanish naming
  the provider and the model, and it carries the remote's own wording when there is any
  (`Ollama respondió 404 … («model 'x' not found»)`), which is the only text that says
  *why*.
- **Ollama extraction must set `num_ctx` explicitly.** The default context is a few
  thousand tokens and Ollama silently drops the overflow — the model then answers
  confidently about half the meeting. `lib/extractors/ollama.ts` floors it at 32768 and
  doubles up to 131072 from `meta.approxTokens`. `think: false` belongs next to it:
  a reasoning model otherwise wraps the JSON in its thinking block.
- **Claude extraction never indexes `content[0]`, and checks `stop_reason` first.**
  `claude-sonnet-5` thinks by default, so the JSON is in the first block of type
  `text`, not the first block — `lib/extractors/claude.ts` scans for it. Two stop
  reasons are handled *before* the content is touched: `refusal` (Anthropic declined;
  `content` is empty or partial, and parsing it would report "no tasks" for a
  transcript nobody read) and `max_tokens` (thinking and the JSON share one budget, so
  a long transcript can truncate the answer mid-object). The Messages request also
  carries no `temperature`/`top_p`/`top_k` — current models reject all three with 400.
- **The provider is chosen server-side, in `app/api/extract/route.ts`, never sent by the
  browser.** `POST /api/extract` takes only `{ path }`; which extractor runs, with which
  model and which key, comes from `getConfig()`. The split of statuses is the rule to
  keep: *missing configuration* is a 400 raised by the route before any call leaves the
  machine (no Claude key, no Ollama model), while anything the provider itself refuses
  arrives as `ExtractionError` and `describeError` turns it into a 502 carrying the
  provider's own wording. The extractors keep their own guards for these cases so they
  are safe to call directly, but the route answers first and answers 400.
- **Request input keeps arriving through `lib/api.ts`.** `pathFromBody(request)` is the
  `POST` counterpart of `pathParam(request)`: it rejects a non-JSON body and a missing or
  blank `path` with a 400 instead of defaulting to the root, which a `POST` never means.
  The route still hands the raw string to `readTranscript`, so `resolveInsideRoot` stays
  the only place a request becomes a path.
- **The task table's drafts are keyed by path and live in `Explorer`, not in the table.**
  `useTaskDrafts(relPath)` (`app/use-task-drafts.ts`) holds a
  `Record<path, { rows, baseline, generating, error, extracted, confirming }>` for every transcript visited
  since the page loaded, so browsing to another note and back shows the edits again. A
  row is `ExtractedTask & { id, include }` — `id` is a page-lifetime counter, `include`
  starts `true`. Unlike `useTranscript`, an extraction is **never** re-run on selection:
  it costs minutes and money, so it only happens on «Generar tareas». A failure patches
  `{ generating, error }` and leaves `rows` alone — the table is what the user has been
  curating and clearing it on error is the bug this rule exists to prevent.
- **«Dirty» is a diff against a baseline, never a boolean flipped by an onChange.**
  `TaskDraftState.baseline` is the rows exactly as the last extraction returned them, and
  `countManualChanges(state)` (`app/use-task-drafts.ts`) diffs `rows` against it by `id`:
  rows only in `rows` are added, rows only in `baseline` are removed, rows in both that
  differ in any user-visible field (title, description, priority, mentioned, evidence,
  `include`) are edited. This is what lets the confirmation *name a number* — and the
  number counts rows, not keystrokes, so it is one the user can check against the table.
  It also self-heals: typing a character and deleting it again leaves the count at zero,
  which a flag never does. The baseline is replaced only by an extraction that returned
  something, so a failed regeneration neither clears the rows nor inflates the count.
- **A destructive action confirms with per-path state, not a component-local one.**
  `confirming` lives in the drafts map next to `rows`, because `TaskTable` is *not*
  unmounted when the selection changes — a `useState` inside it would carry a pending
  confirmation over to the next file and offer to discard the wrong table. Keyed by path,
  switching files hides the dialog and coming back restores it, matching the drafts.
  «Cancelar» only clears that flag: nothing else in the state is touched, which is the
  literal reading of «leaves the current table untouched».
- **Client → route helpers all read the same.** `lib/browse-client.ts`,
  `lib/transcript-client.ts` and `lib/extract-client.ts` each wrap one route, throw an
  `Error` carrying the route's own Spanish message, and answer «El servidor devolvió una
  respuesta inesperada» for a well-formed response of the wrong shape. A new route the
  browser calls gets a helper next to these, not a `fetch` inside a component.
- **A paginated Linear connection is followed to the end, never read as one page.**
  `listTeamsAndProjects` walks `teams` by cursor and, for a team whose `projects` did
  not fit in its nested page, finishes that team with its own `TeamProjects` query —
  the common workspace costs exactly one request. Silently keeping the first page
  would hide the very project the user is looking for, which is worse than being slow.
  Every cursor loop is bounded by `MAX_PAGES` so a looping cursor cannot hang a route,
  and `readConnection` only reports `hasNextPage` when an `endCursor` came with it, so
  a malformed `pageInfo` ends the walk instead of refetching page one forever.
- **A cursor mid-parse is a return value, never module state.** Route handlers run
  concurrently in one server process, so a `Map` at module scope shared between two
  in-flight requests would let one clear the other's pagination. `readTeam` returns
  `{ team, projectsCursor }` and the caller threads it — the concurrency bug this rule
  exists to prevent never reproduces on a single manual request.
- **A GraphQL mutation's own success flag is checked before its payload.** `issueCreate`
  answers HTTP 200 with `{ success: false, issue: null }` and no `errors`, so
  `createIssue` (`lib/linear.ts`) rejects on `success !== true` before reading the issue —
  otherwise a failed push reports a created task with an empty identifier. The remote's
  message, when there is one, still arrives through `linearGraphQL`'s `errors` check.
- **`createIssue(apiKey, input)` is the single way an issue is written**, for the tasks
  and for the parent they hang from: the parent is the same call without a `source`, and
  its id becomes every task's `parentId`. Optional ids are spread in only when non-empty
  (`...(projectId ? { projectId } : {})`) so «no project» is an absent key, not a null.
  Priority goes through `LINEAR_PRIORITY: Record<Priority, number>` (none=0, urgent=1,
  high=2, medium=3, low=4) — Linear orders by urgency, the inverse of what our
  `PRIORITIES` order suggests, and the typed record turns the mismatch into a compile
  error instead of a workspace full of urgent tasks.
- **Traceability lives in the issue body, built by `buildIssueDescription`.** After a
  `---` rule: the meeting title and date, the mentioned person when the transcript named
  one, and the evidence as a blockquote with `>` on *every* line (a quote is verbatim and
  can be multi-line; an unprefixed second line escapes the quote). Missing fields drop
  out and an empty block is never appended. It is written in English, like the extracted
  tasks — the Spanish copy rule covers *our* UI, not the content pushed to Linear.
- **Mutations are Server Actions; only the settings page calls `refresh()` after one.**
  `saveLastProject` (`app/actions.ts`) persists the push panel's project without
  refreshing: the explorer holds the selection in client state, so re-rendering the page
  would cost a round trip to redraw what is already on screen. `refresh()` belongs to a
  page that *reads* the mutated config on the server. A preference write also swallows its
  error — a rejected promise in an `onChange` is an unhandled rejection over something
  nobody asked to save.
- **An input prefilled from async data stores `null` while untouched, never `''`.**
  `PushOptions.parentTitle` is `string | null` and the panel renders
  `parentTitle ?? meetingTitle`. The transcript is fetched after the first paint, so a
  `useState(meta.title)` initialiser would capture an empty title forever; `null` tracks
  the note as it loads and stops the instant the user types — including typing nothing,
  which an `||` fallback would silently overwrite.
- **The reason a button is disabled is one function returning one string.**
  `pushBlockedBy(target, parent, selectedTasks)` in `app/push-panel.tsx` returns the first
  blocker in the order the user has to fix them (no key → still loading → listing failed →
  no project → no tasks checked → empty parent title), and that string is both the
  button's `title` and the copy beside it. Asking for a project while the key is missing
  is noise, and two independent conditions rendering two messages is how a form starts
  contradicting itself.
- **Client state that is workspace-wide is not keyed by path; state that describes one
  note is.** `usePushTarget` holds the team/project for the whole page (loaded once —
  a workspace does not change while a note is curated) and remembers it in the config,
  while `usePushOptions` keys «Crear tarea padre» and its title by path like the drafts,
  because the panel is not unmounted when the selection changes and one meeting's parent
  title must never be offered for the next one.
- **Verifying a client-rendered panel needs no Playwright install.** Node's global
  `WebSocket` drives Chrome over CDP: launch
  `--headless=new --remote-debugging-port=<p>`, read `/json/list`, then `Runtime.evaluate`.
  Setting a React-controlled input from there requires the native value setter
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)`)
  before dispatching `input`/`change`, or React never sees the change.

---


## 2026-08-09 - US-001

Project baseline: quality gate, port 3300, local data folder.

**What was implemented**
- `typecheck` script: `next typegen && tsc --noEmit` (typegen is required, see Patterns).
- `dev` script runs on port 3300 (`next dev -p 3300`); `start` matched to `-p 3300` for consistency.
- Installed `yaml` (^2.9.0) as a runtime dependency for the frontmatter parsing in US-003.
- `.gitignore` now ignores `/.data/`.
- `lib/data-dir.ts` — `DATA_DIR`, `ensureDataDir()` (mkdir recursive, idempotent), `dataFile(name)`.
- `instrumentation.ts` — calls `ensureDataDir()` once at server startup, so `.data/` exists
  before any route touches it.

**Files changed**
- `package.json`, `pnpm-lock.yaml`, `.gitignore`
- `lib/data-dir.ts` (new), `instrumentation.ts` (new)

**Verification**
- `pnpm typecheck` passes.
- `pnpm dev` serves on http://localhost:3300 (HTTP 200) and creates `.data/` on boot.
- `git check-ignore -v .data/` → matched by `.gitignore:24`; `.data/` absent from `git status`.

**Learnings**
- Gotcha: bare `tsc --noEmit` fails on a clean tree until `next typegen` has run.
- Gotcha: `next dev` writes to `.next/dev` (not `.next`) in this version, so dev and build
  can run concurrently.
- `next typegen` also regenerates `next-env.d.ts`; that file is already gitignored here.
---

## 2026-08-09 - US-002

Config store: read/write local JSON state.

**What was implemented**
- `lib/store.ts` — persistence layer over `.data/config.json`, built on `dataFile()`
  from `lib/data-dir.ts` (no hardcoded `.data` path).
- `Config` shape: `recentFolders`, `contextRoot`, `provider` ('ollama' | 'claude'),
  `ollamaModel` (defaults to `qwen3:8b`, the model US-006 preselects), `claudeApiKey`,
  `linearApiKey`, `lastProjectId`, and `history: Record<string, HistoryEntry[]>` keyed
  by the transcript path relative to `contextRoot`.
- Exported types `Provider`, `HistoryIssue`, `HistoryEntry`, `Config` and helper
  `defaultConfig()` so later stories can type against one source of truth.
- Helpers: `getConfig()`, `updateConfig(partial)`, `addHistoryEntry(relPath, entry)`,
  `getHistory(relPath)`. `updateConfig`/`addHistoryEntry` return the written config.
- Tolerant reads: `normalize()` coerces arbitrary parsed JSON field by field, so a
  hand-edited or half-written file degrades to defaults per field instead of throwing.
- Atomic writes: serialize to `.config.json.<pid>.<n>.tmp` in `.data/` then
  `fs.renameSync` onto the target; the temp file is removed if the write fails.

**Files changed**
- `lib/store.ts` (new)

**Verification**
- `pnpm typecheck` passes.
- Ran a throwaway Node script (Node 26 runs `.ts` directly) against a scratch
  `DATA_DIR` covering every acceptance criterion: missing file → defaults; `{ not json`,
  `[1,2,3]` and wrong-typed fields → defaults; `updateConfig` merge + persist across
  reads; two `addHistoryEntry` calls append in order, stay keyed per relPath, and leave
  other config fields intact; unknown key → `[]`; no `.tmp` files left in `.data/`.

**Learnings**
- Node 26 executes `.ts` files natively, which makes ad-hoc verification of a node-only
  module cheap — but its ESM resolver needs explicit extensions, so extensionless
  relative imports (`./data-dir`, fine under `moduleResolution: bundler`) must be
  rewritten to `./data-dir.ts` in a scratch copy before running.
- Gotcha: `renameSync` is only atomic within one filesystem, so the temp file has to
  live in `.data/` alongside the target — not in `os.tmpdir()`.
- Kept the temp filename unique per process *and* per call (`<pid>.<n>`); two writes in
  the same tick would otherwise race on one temp path.
---

## 2026-08-09 - US-003

Filesystem scanner with path-traversal guard.

**What was implemented**
- `lib/transcripts.ts` — the single entry point for reading anything under `contextRoot`.
- `resolveInsideRoot(root, relPath)` — resolves and throws on escape. Two checks: a
  lexical one (`path.resolve` + prefix compare, catches `..` and absolute input) and a
  `realpathSync` one (catches a symlink inside the root pointing outside it).
- `listFolder(root, relPath)` — one level only, no recursion. Returns
  `{ relPath, folders, files }`; skips dotfiles, `node_modules`, non-`.md` files and
  files that fail to read. Files sorted date desc then title (what US-008 asks for).
- `readTranscript(root, relPath)` — `{ meta, body }` with the frontmatter block removed.
- `TranscriptMeta`: `relPath`, `fileName`, `title`, `date`, `attendees`, `words`,
  `approxTokens`, `hasFrontmatter`. Exported types `FolderEntry`, `FolderListing`,
  `Transcript` so US-004/US-008 type against one source of truth.
- Frontmatter parsed with `yaml`; failures (and non-object YAML) degrade to
  "no frontmatter", leaving the raw text as body. Fallbacks: title from the filename
  (leading date and `-`/`_` stripped), date from a leading `YYYY-MM-DD`.
- `attendees` accepts a YAML list or a single comma-separated line; `date` accepts
  `YYYY-MM-DD`, a full ISO timestamp, or a `Date`.

**Files changed**
- `lib/transcripts.ts` (new)

**Verification**
- `pnpm typecheck` passes.
- Ran a throwaway Node script (Node 26 runs `.ts` directly) against a scratch tree —
  32 assertions, all passing: traversal via `..`, a symlink to a file outside the root
  and an absolute path; dotfile / `node_modules` / `.txt` exclusion; non-recursion;
  frontmatter vs filename-derived title and date; comma-separated and list attendees;
  malformed YAML kept as body without throwing; word count on the body only; sort order;
  root-relative `relPath` for nested files.

**Learnings**
- Gotcha: the lexical check alone is not enough. `path.resolve` cannot see symlinks, so
  a `link.md` inside the root pointing at `../outside.md` passes the prefix compare —
  `realpathSync` on the resolved target is what catches it. `realpathSync` throws on a
  path that does not exist yet, so it falls back to the input and the lexical check
  stands on its own for missing paths.
- Decision: a leading `/` in `relPath` is stripped rather than rejected, so the API in
  US-004 can accept URL-style `/sub/notes.md`. `/etc/passwd` becomes `<root>/etc/passwd`
  and simply misses — it cannot reach the host path.
- YAML 1.2's core schema (the `yaml` package default) parses `date: 2026-08-09` as a
  **string**, not a `Date`. `toIsoDate` handles both anyway, since a future schema
  change would silently flip the type.
- `listFolder` reads every `.md` file in the folder to build its metadata. Fine for a
  notes folder; if a root ever holds thousands of files this is the thing to cache.
---

## 2026-08-09 - US-004

API routes for browsing folders and reading a transcript.

**What was implemented**
- `app/api/browse/route.ts` — `GET /api/browse?path=<relPath>` returns the `FolderListing`
  from `listFolder(contextRoot, path)` (subfolders + `.md` metadata). Omitting `path`
  lists the root.
- `app/api/transcript/route.ts` — `GET /api/transcript?path=<relPath>` returns
  `{ meta, body }` from `readTranscript`. Rejects a missing `path` and any path not
  ending in `.md`, so the route cannot serve files the explorer never listed.
- `lib/api.ts` — shared route plumbing: `HttpError`, `requireContextRoot()`,
  `pathParam()`, `jsonError()`, `errorResponse()` (see Patterns for the status mapping).
- `lib/transcripts.ts` — added an exported `PathEscapesRootError`; `resolveInsideRoot`
  now throws it instead of a bare `Error`. Same message, but the routes can answer 400
  without matching on the message text.

**Files changed**
- `app/api/browse/route.ts` (new), `app/api/transcript/route.ts` (new)
- `lib/api.ts` (new), `lib/transcripts.ts` (modified)

**Verification**
- `pnpm typecheck` passes.
- Ran `pnpm dev` against a scratch root (`/tmp/ctx-root`: a frontmatter note, a plain
  note, `sub/`, a `.txt`, a `folder.md` directory, and `link.md` → `/tmp/outside.md`)
  and curled every criterion:
  - 200: root listing (folder + 2 `.md`, `.txt` and the symlink excluded), `?path=sub`,
    `?path=/sub` (leading slash), transcript with and without frontmatter.
  - 400 escape: `?path=../..`, `?path=../outside.md`, `?path=sub/../../outside.md`,
    `?path=link.md` (symlink out of the root).
  - 400 no contextRoot: both routes, with the key absent and with a whitespace value.
  - 404: `?path=nope`, `?path=missing.md`, and a `contextRoot` that no longer exists.
  - 400 wrong kind: `browse` on a file (ENOTDIR), `transcript` on a directory named
    `folder.md` (EISDIR), on `ignoreme.txt` and on a missing `path`.
- `.data/config.json` and the scratch tree were removed afterwards; `git status` clean
  apart from this story's files.

**Learnings**
- Next 16 needs no route segment config here: `GET` handlers have been dynamic by
  default since v15 (`route.md` version table), and `nodejs` is the default runtime —
  `export const runtime = 'edge'` is deprecated in this version.
- Gotcha: reading the query with `new URL(request.url).searchParams` keeps the handler
  signature to plain `Request`; `NextRequest`/`nextUrl` is only needed for cookies and
  the parsed URL extras.
- `listFolder` already drops symlinks for free: `withFileTypes` reports a symlink as
  `isSymbolicLink()`, so `entry.isFile()` is false and it never reaches the listing.
  `readTranscript` is where the symlink guard actually matters, and it returns 400.
- The `.md` check in the transcript route runs before the traversal guard, so
  `?path=../../etc/hosts` is refused as "not a .md" rather than as an escape. Both are
  400 with a clear message, so the acceptance criterion holds either way.
---

## 2026-08-09 - US-005

Settings UI: context folder path with recents.

**What was implemented**
- `app/settings/page.tsx` — server component, reads `getConfig()` and passes
  `contextRoot` + `recentFolders` down. `export const dynamic = 'force-dynamic'` so the
  page is never prerendered with a stale config (it reads the filesystem, not a
  request-time API, so `auto` would let Next prerender it at build time).
- `app/settings/actions.ts` — `openFolderAction(previous, formData)`, the single
  Server Action behind both the «Abrir» button and every recents entry. Returns
  `OpenFolderState` (`folder`, `error`, `attempt`); on success calls `refresh()` from
  `next/cache` so the server component re-renders with the new active folder and list.
- `app/settings/context-folder-form.tsx` — client component, `useActionState`. One
  `<form>` holds the text input *and* the recents buttons; each recent is a
  `<button type="submit" name="recent" value={path}>`, so clicking it submits the same
  action with its own path. The action prefers `recent` over `folder`.
- `lib/context-root.ts` — `openContextRoot(input)`: normalize → validate → persist,
  and `MAX_RECENT_FOLDERS = 8`. Recents are `[folder, ...others].slice(0, 8)`, so
  reopening a folder promotes it instead of duplicating it.
- `lib/api.ts` — split `errorResponse` into `describeError(err, relPath)` returning
  `{ status, message }` plus a thin `errorResponse` that wraps it in a `Response`.
  Same mapping, now reachable from a Server Action, which answers with state.

**Files changed**
- `app/settings/page.tsx`, `app/settings/actions.ts`,
  `app/settings/context-folder-form.tsx`, `lib/context-root.ts` (all new)
- `lib/api.ts` (modified)

**Verification**
- `pnpm typecheck` passes.
- Drove a real Chrome against `pnpm dev` with Playwright — 19 assertions, all passing:
  empty-state copy; `/tmp/no-existe` → "No existe" inline and `config.json` never
  written; a file path → "No es una carpeta"; a relative path → "debe ser absoluta";
  a valid folder → saved as `contextRoot`, appears in recents, marked "Activa";
  a second folder goes to the top and takes the mark; clicking the first recent switches
  back with no duplicate; opening 8 more caps the list at 8 and drops the oldest;
  the choice survives a reload; `GET /api/browse` then lists the chosen folder.
- Scratch folders and `.data/config.json` removed afterwards.

**Learnings**
- Gotcha: a `'use server'` file may only export async functions. The initial
  `useActionState` value cannot live there — only the `export type` does (types are
  erased); the client component builds the initial state from its props.
- `refresh()` from `next/cache` is this version's way to re-render the current route
  after a Server Action, and it *only* works inside one (`revalidatePath` is for cache
  tags/paths; the settings page has no cache entry to invalidate, it re-reads a file).
- `fs.opendirSync(folder)` is the single check that covers all three failure modes:
  ENOENT (missing), ENOTDIR (a file) and EACCES (not listable). `statSync` answers the
  first two but says nothing about readability, which the story explicitly asks for.
- Gotcha: `page.locator('[role="alert"]')` matches Next's `__next-route-announcer__`
  too — target the error node by id when testing an inline error with Playwright.
- Pattern for keeping a controlled input in sync with an action that can be triggered
  from elsewhere: the action returns an incrementing `attempt`, and the component
  copies `state.folder` into its input state during render when `attempt` changes.
  Comparing the path alone cannot distinguish two consecutive failures on the same one.
- `path.resolve` on the trimmed input is what makes "no duplicates" hold in practice:
  `/tmp/notas/` and `/tmp/notas` would otherwise be two different recents.
---

## 2026-08-09 - US-006

Settings UI: extraction provider selector.

**What was implemented**
- `lib/ollama.ts` — the local Ollama server as seen from the app: `OLLAMA_URL`
  (env `OLLAMA_URL`, default `http://127.0.0.1:11434`, trailing slashes stripped),
  `DEFAULT_OLLAMA_MODEL = 'qwen3:8b'`, `listOllamaModels()` (`GET /api/tags`, 3 s
  timeout, `cache: 'no-store'`, names deduped and sorted) and `OllamaUnreachableError`.
  Reachable-with-zero-models and unreachable are deliberately different results:
  `[]` versus a throw.
- `app/api/ollama/models/route.ts` — `GET /api/ollama/models` → `{ url, models }`,
  errors through the shared `errorResponse`.
- `lib/api.ts` — `describeError` maps `OllamaUnreachableError` to 503 with the Spanish
  message (the lib carries the URL, the mapping carries the copy).
- `lib/store.ts` — the `ollamaModel` default now references `DEFAULT_OLLAMA_MODEL`
  instead of repeating the literal.
- `app/settings/provider-form.tsx` — client component: radios for
  «Ollama (local, gratis)» / «Claude API (de pago)», the model `<select>` (only while
  Ollama is picked), the password input for the Anthropic key, and the per-token
  billing warning rendered next to the Claude option (visible without selecting it).
  A `useOllamaModels(enabled)` hook fetches the list from the browser and exposes
  `reload()` behind a «Reintentar» button.
- `app/settings/actions.ts` — `saveProviderAction`, persisting provider + model + key
  through `updateConfig` and calling `refresh()`.
- `app/settings/page.tsx` — reads the config and renders `ProviderForm`, passing
  `hasClaudeApiKey` (a boolean) and `defaultModel`, never the key itself.

**Files changed**
- `lib/ollama.ts`, `app/api/ollama/models/route.ts`, `app/settings/provider-form.tsx` (new)
- `lib/api.ts`, `lib/store.ts`, `app/settings/actions.ts`, `app/settings/page.tsx` (modified)

**Verification**
- `pnpm typecheck` passes.
- Drove a real Chrome against `pnpm dev` with Playwright — 35 assertions, all passing:
  Ollama default + list populated from the real local server with `qwen3:8b`
  preselected; the Claude warning present and visible before selecting Claude;
  switching providers swaps `<select>` ↔ `type=password`; provider, model and key
  persisted to `.data/config.json` and surviving a reload; the key absent from the
  page HTML and shown as a masked placeholder; «Borrar» clearing it. With
  `OLLAMA_URL` pointed at a dead port and then at a stub server: unreachable → the
  `ollama pull qwen3:8b` message with the connection error, zero models → the same
  instruction without the connection error, and «Reintentar» picking up models
  the moment the stub started answering (`qwen3:8b` preselected out of three).
- Dev server stopped and `.data/` removed afterwards.

**Learnings**
- Decision: the model list is fetched from the *browser* against a route rather than
  in the server component. The settings page then renders instantly even with Ollama
  down (no 3 s block), and «Reintentar» after `ollama pull` costs no reload.
- Gotcha: `process.env.OLLAMA_URL` cannot be read from a client component — Next only
  inlines `NEXT_PUBLIC_*` — so `DEFAULT_OLLAMA_MODEL` reaches the form as a prop from
  the server page instead of by import.
- Node resolves `localhost` to `::1` first on this machine while Ollama binds IPv4, so
  the default URL is `127.0.0.1` on purpose.
- Ollama answers `{ models: [{ name, model, … }] }`; `name` and `model` are the same
  string for a plain pull, so the parser takes `name` and falls back to `model`.
- Decision: no hard validation when Claude is selected without a key — the save
  succeeds and the form says a key is needed. Blocking the save would also block the
  «Borrar» button, and US-011/012 have to handle a missing key at extraction time anyway.
---

## 2026-08-09 - US-007

Settings UI: Linear API key.

**What was implemented**
- `lib/linear.ts` — the Linear GraphQL API as seen from the app: `LINEAR_API_URL`
  (env `LINEAR_API_URL`, default `https://api.linear.app/graphql`, trailing slashes
  stripped), `linearGraphQL(apiKey, query, variables)` (POST, 15 s timeout,
  `cache: 'no-store'`, returns the `data` payload) and `fetchLinearOrganization(apiKey)`
  → `{ id, name, urlKey }`. Two error types: `LinearUnreachableError` (never reached
  Linear) and `LinearApiError` (Linear refused, carrying its own message plus the
  status our routes should answer).
- `app/api/linear/verify/route.ts` — `GET /api/linear/verify` → `{ organization }`.
  Reads the key from the config server-side; 400 with a Spanish message when none is
  stored, everything else through the shared `errorResponse`.
- `lib/api.ts` — `describeError` maps `LinearUnreachableError` to 503 and
  `LinearApiError` to its own status, forwarding Linear's wording untouched.
- `app/settings/actions.ts` — `saveLinearKeyAction`, write-only like the Anthropic key:
  an empty submit keeps what is stored, `intent=clear-linear-key` erases it, then
  `refresh()`.
- `app/settings/linear-form.tsx` — client component: password input, «Guardar»,
  «Probar» (fetches the route and shows «Conectado al espacio de trabajo «X».» or the
  error), «Borrar» when a key is stored, and the note that the key is saved unencrypted
  in the local `.data` folder.
- `app/settings/page.tsx` — renders `LinearForm` with `hasLinearApiKey`, a boolean.

**Files changed**
- `lib/linear.ts`, `app/api/linear/verify/route.ts`, `app/settings/linear-form.tsx` (new)
- `lib/api.ts`, `app/settings/actions.ts`, `app/settings/page.tsx` (modified)

**Verification**
- `pnpm typecheck` passes.
- Drove a real Chrome against `pnpm dev` with Playwright — 28 assertions, all passing,
  with `LINEAR_API_URL` pointed at a stub reproducing Linear's exact response shapes:
  password input and `lin_api_…` placeholder in the empty state; «Probar» disabled
  with no key and while the input holds unsaved text (with the inline hint); save →
  «Guardado.», field cleared, key in `.data/config.json`; masked placeholder afterwards
  and the key absent from both the page HTML and the RSC payload of `/settings`;
  «Probar» → «Conectado al espacio de trabajo «Acme Inc».» and the route answering
  `{ organization }` with no key in it; the verdict not surviving a reload nor an edit;
  an invalid key → 401 and Linear's own message inline; «Borrar» emptying the key and
  disabling «Probar»; no key → 400 in Spanish.
- Then re-ran against the **real** `api.linear.app` with an invalid key: the UI showed
  `Linear: Authentication required, not authenticated` and the route answered 401 —
  same text `curl` gets from Linear directly. The success path was exercised against
  the stub only; verifying it against a real workspace needs a real personal API key,
  which this environment does not have.
- Dev server and stub stopped, `.data/` removed afterwards.

**Learnings**
- Gotcha, cost the first test run: Next 16 blocks cross-origin dev resources, and
  `http://127.0.0.1:3300` counts as cross-origin against a server that reports
  `localhost`. The JS chunks are refused, the client component never hydrates, and the
  symptom is a page that renders fine while every button does nothing. Use `localhost`.
- Linear replies **HTTP 400 or 401** with `{ errors: [{ message }] }` to a bad personal
  API key, and reports GraphQL-level failures with a 200 — so the body has to be
  inspected before the status, not after.
- Personal API keys go in `Authorization` verbatim; the `Bearer` prefix is for OAuth
  tokens and makes Linear reject an otherwise valid key.
- Decision: «Probar» checks the *stored* key rather than the typed one. A GET route
  keeps the secret out of URLs and bodies, and the button stays disabled while there is
  an unsaved edit so its verdict can never describe a key that is not in use.
- Decision: `LINEAR_API_URL` is env-overridable purely so the app can be driven against
  a stub. Same shape as `OLLAMA_URL`, and it is what made the success path testable
  without a real workspace.
- A save invalidates the last «Probar» verdict, so the component clears it on a
  successful save and hides it as soon as the input is touched — a stale green line is
  worse than none.
---

## 2026-08-09 - US-008

Explorer UI: folder tree and file list.

**What was implemented**
- `lib/browse-client.ts` — `fetchFolder(relPath)`, the browser side of
  `GET /api/browse`. Borrows `FolderListing` from `lib/transcripts.ts` as a *type-only*
  import, so the node-only scanner never reaches the client bundle. A failure becomes
  an `Error` carrying the route's own Spanish message; an unparseable or unexpected
  body gets a generic one.
- `app/use-folder-listings.ts` — `useFolderListings()`, the explorer's cache of
  listings keyed by root-relative path (`states`, `open`, `reload`). `open` skips
  folders already asked for (so clicks and StrictMode double-effects cost one request),
  `reload` forces a refetch, and a per-path attempt counter keeps a slow response from
  overwriting a newer one.
- `app/folder-tree.tsx` — the lazy tree. Each node has a chevron toggle
  (`aria-expanded`) and a label button that selects the folder; the toggle disappears
  once a listing proves the folder has no subfolders. Per-node loading and error states
  with «Reintentar».
- `app/file-list.tsx` — the centre panel: breadcrumb + file count, one row per `.md`
  file with title, date (`<time dateTime>` + `9 ago 2026`), attendees (first 3, then
  `+N`) and `~N palabras`. Two empty states, depending on whether the folder has
  subfolders to offer.
- `app/explorer.tsx` — composition and the shared state (expanded set, selected folder,
  selected file). Selecting a folder also expands it; collapsing is the chevron's job.
- `app/page.tsx` — server component, `force-dynamic`, reads `contextRoot` from the
  config. Without one it renders the call to action linking to `/settings`; with one,
  the header (active path + «Ajustes») and `<Explorer>`.
- `app/layout.tsx` — real metadata (`Tasks App` + `%s · Tasks App` template) replacing
  the create-next-app defaults.

**Files changed**
- `lib/browse-client.ts`, `app/use-folder-listings.ts`, `app/folder-tree.tsx`,
  `app/file-list.tsx`, `app/explorer.tsx` (new)
- `app/page.tsx`, `app/layout.tsx` (modified)

**Verification**
- `pnpm typecheck` passes. `pnpm build` passes; its only warnings are the pre-existing
  `lib/transcripts.ts` fs-tracing ones, and their import traces list App Route and
  Server Component only — no client trace, confirming the scanner stays server-side.
- Drove a real Chrome against `pnpm dev` with Playwright — 44 assertions, all passing,
  over a fixture tree (`notas/` with `proyectos/{alfa,beta}`, `archivo/`, files with
  frontmatter, with a filename-only date, with a malformed frontmatter, with nothing,
  plus a dotfile, a `.txt` and a `node_modules/`): the CTA and its `/settings` link with
  no root configured; setting the folder from Ajustes and coming back; the tree rooted
  at `notas` with children sorted alphabetically and `node_modules` absent; the root
  listing sorted date-desc-then-title (`Revisión de producto`, `Weekly sync`,
  `Planificación de mayo`, `roto`, `sin fecha`); dates from frontmatter, from an ISO
  timestamp and from a filename; no date shown when unknown; attendees capped at
  `Ana Ruiz, Luis Pérez, Marta Gil +1`; the word count matching the file on disk;
  breadcrumb and file count following the selection; both empty states; leaves without
  a chevron; collapse hiding the subtree while the file list keeps its selection;
  re-expand restoring it without a refetch; and — after renaming a folder away
  mid-session — «No existe: archivo» inline with «Reintentar» recovering it.
- Dev server stopped and `.data/` plus the fixtures removed afterwards.

**Learnings**
- Decision: the explorer fetches from the browser (`/api/browse`) instead of listing on
  the server. Expanding a node costs one request rather than a re-render of the route,
  the listing is shared by both panels, and a folder that vanishes from disk fails in
  place with a «Reintentar» instead of breaking the page. This is why US-004 exists.
- Gotcha: `body` is `min-h-full flex flex-col`, so a `flex-1` child is sized by its
  content — `overflow-y-auto` inside it never scrolls, the whole page grows instead.
  The explorer page therefore uses a definite `h-dvh` on its root; panels then scroll
  independently. Same trap for any future full-height view.
- A lazily-loaded tree does not know whether a folder has children until it has been
  listed, so the chevron is rendered until a listing proves the node is a leaf, and
  then removed. The alternative — always showing it — produces chevrons that expand
  into nothing, which reads as a bug.
- Sorting is not repeated in the UI: `listFolder` already returns files date-desc then
  title, and the file list renders them in arrival order (noted in a comment so nobody
  "fixes" it by re-sorting).
- `new Date('2026-08-09')` parses as UTC midnight and renders as the previous day west
  of Greenwich, so dates are split and passed to `new Date(y, m - 1, d)` before
  `Intl.DateTimeFormat('es-ES')`. The raw ISO string stays in `<time dateTime>`.
- Testing gotcha: `page.waitForFunction` on `document.body.innerText` is ambiguous once
  the same folder name appears in both the tree and the breadcrumb — the collapse
  assertion has to scope to `nav[aria-label="Carpetas"]`.
---

## 2026-08-09 - US-009

Transcript preview and already-processed notice.

**What was implemented**
- `lib/markdown.ts` — a small Markdown parser producing a block/inline tree of plain
  data (no HTML, no node imports). Covers headings, fenced code, blockquotes, nested
  bullet/numbered lists, rules, paragraphs, and inline code, `**bold**`, `_italic_`,
  `~~strikethrough~~`, links, `<autolinks>` and bare URLs. `safeHref` allows only
  `http(s)`, `mailto` and relative targets.
- `app/markdown.tsx` — `<Markdown source>`, which renders that tree as React elements
  with Tailwind classes (no typography plugin in this project, so each element is
  styled directly).
- `lib/transcript-client.ts` — `fetchTranscript(relPath)` plus the `TranscriptView`
  type (`Transcript & { history }`), both type-only imports from the node-only modules.
- `app/use-transcript.ts` — `useTranscript(relPath)`: loading/ready/error state for the
  selected file, an attempt counter so a slow response cannot overwrite a newer
  selection, and `reload()` behind «Reintentar». Not cached, on purpose.
- `app/transcript-preview.tsx` — the right panel: a fixed header (title, date,
  attendees, word count, file name), the already-processed notice, and the scrollable
  body. Empty states for no selection and for a file that is only frontmatter.
- `app/api/transcript/route.ts` — the response now carries `history: getHistory(path)`.
- `app/explorer.tsx` — third panel wired in; the file list becomes a fixed `w-96`
  column and the preview takes the rest.

**Files changed**
- `lib/markdown.ts`, `lib/transcript-client.ts`, `app/markdown.tsx`,
  `app/transcript-preview.tsx`, `app/use-transcript.ts` (new)
- `app/api/transcript/route.ts`, `app/explorer.tsx` (modified)

**Verification**
- `pnpm typecheck` passes. `pnpm build` passes; its fs-tracing warnings still list only
  App Route and Server Component traces — no Client Component trace, so neither the
  scanner nor the store leaked into the browser bundle.
- Drove a real Chrome against `pnpm dev` with Playwright — 55 assertions, all passing,
  over a fixture folder (a long Weekly sync with the full Markdown range, a short retro,
  a frontmatter-only file, and a file with hostile links) plus a hand-written
  `.data/config.json` history: the no-selection state; header metadata; the notice
  reading «3 tareas creadas el 9 ago 2026 a las 09:32» with one link per issue pointing
  at its stored url and showing its identifier and title; the notice sitting above the
  body; every Markdown construct rendering to its own element (h3/h4, `ul`, nested
  `ul ul`, `ol`, `blockquote`, `pre code`, `hr`, `strong`, `em`, `del`, inline `code`,
  links with `target=_blank`); the bare URL linked; frontmatter absent from the body;
  the preview scrolling (`scrollTop > 100`) while the page itself does not grow and the
  header and tree stay put; a file pushed twice reading «3 tareas creadas en 2 envíos,
  el último el 5 ago 2026» with each push dated and the most recent first; no notice at
  all for a file without history; `[texto](javascript:…)` rendering as text with no
  anchor; an embedded `<script>` shown verbatim and `window.__pwned` still undefined;
  `snake_case` not italicised; and — after renaming a file away mid-session — «No
  existe: riesgos.md» inline with «Reintentar» recovering it. No page errors.
- Dev server stopped and `.data/` plus the fixtures removed afterwards.

**Learnings**
- Decision: no Markdown dependency. The parser is ~300 lines, and building React
  elements from a data tree means a transcript can never inject HTML — with
  `react-markdown` the same guarantee costs a plugin chain, and the app has to render
  arbitrary files from the user's disk. Tables are the one real omission; they degrade
  to paragraphs with pipes.
- Gotcha: nested lists are not parsed by the list parser at all. Each item's lines are
  dedented by that item's own content indent and re-parsed with `parseBlocks`, so a
  sublist simply appears as a list inside the item. Trying to track depth in one pass
  was where the first attempt got complicated.
- Emphasis with `_` needs a word boundary before the delimiter or `snake_case_names`
  render as italics; `*` has no such problem. Same class of bug for `2 * 3 * 4`, which
  is why the opening delimiter must not be followed by a space.
- Paragraphs keep their single newlines (`whitespace-pre-wrap`): meeting notes use them
  for speaker turns, and collapsing them into spaces makes a transcript unreadable.
- `pushedAt` is a full ISO timestamp, so `new Date(...)` is safe for it — unlike the
  date-only `meta.date`, which still has to be split into parts to avoid the UTC-
  midnight shift. Two different formatters in the same file for that reason.
- The folder panel is already an `<aside>`, so the notice is a `<div role="note">`; a
  second unlabelled complementary landmark is noise for a screen reader and made the
  Playwright `aside` locator ambiguous too.
- Decision: history travels inside the transcript response rather than in its own
  route. It is keyed by the same path, always rendered with the preview, and US-019
  needs it fresh after a push — which a re-fetch on selection already gives.
---

## 2026-08-09 - US-010

Ollama extractor.

**What was implemented**
- `lib/extractors/task.ts` — the shared contract, ahead of US-011 which needs the same
  schema and type: `ExtractedTask` (title, description, priority, mentioned, evidence),
  `PRIORITIES`, `ExtractionError`, `TASKS_JSON_SCHEMA`, `SYSTEM_PROMPT`,
  `buildUserPrompt(transcript, meta)` and `normalizeTasks(payload)`.
- `lib/extractors/ollama.ts` — `extractWithOllama(transcript, meta, model)`. POSTs to
  `${OLLAMA_URL}/api/chat` with `format: TASKS_JSON_SCHEMA`, `think: false`,
  `stream: false`, `options.num_ctx` (≥ 32768, grown from `meta.approxTokens`) and
  `temperature: 0`, then parses `message.content` and hands it to `normalizeTasks`.
  Ten-minute timeout — a local model on CPU takes minutes on a long transcript.
  Every failure path throws `ExtractionError` naming Ollama and the model.
- `lib/api.ts` — `describeError` maps `ExtractionError` to 502 with its own message,
  so US-012's route gets the mapping for free.
- `lib/ollama.ts` — header comment updated (it no longer "joins later").

**Files changed**
- `lib/extractors/task.ts`, `lib/extractors/ollama.ts` (new)
- `lib/api.ts`, `lib/ollama.ts` (modified)

**Verification**
- `pnpm typecheck` passes. `pnpm build` passes with only the pre-existing
  `lib/transcripts.ts` fs-tracing warnings (App Route + Server Component traces only).
- Compiled the two modules to CommonJS and ran them against a stub HTTP server —
  30 assertions, all passing: the request goes to `/api/chat` with `think: false`,
  `stream: false`, `num_ctx ≥ 32768` and the schema verbatim in `format`; the system
  prompt carries the three required instructions; the user prompt carries title, date,
  attendees and body; an empty title is dropped, `priority: 'HIGH'` normalises to
  `high`, `'inventada'` falls back to `none` and a blank `mentioned` becomes `null`;
  a 40k-token file grows `num_ctx` to 65536; a bare array is accepted; a 404 throws
  naming Ollama, the model, the status and Ollama's own reason; unparseable content, a
  non-JSON body, an empty message and a missing model each throw with the model named;
  a downed server throws without hanging; and `normalizeTasks` returns `[]` for junk.
- Ran it against the **real** local Ollama with `qwen3:8b` (~48s per transcript): a
  Spanish meeting with three commitments plus one deferred discussion produced exactly
  the three tasks, titles and descriptions in English, `mentioned` filled from the
  attendee names, the TLS renewal marked `urgent`, and evidence quoted from the
  transcript; a small-talk transcript with no commitments produced `[]`; a model that
  is not pulled produced
  `Ollama respondió 404 al extraer con el modelo «no-existe:1b» («model 'no-existe:1b' not found»)`.

**Learnings**
- Decision: the shared module lands with US-010 rather than being extracted during
  US-011. The Claude extractor's ACs already demand one schema and one type, and the
  schema is the harder half — writing it once, inside the intersection of what both
  APIs accept, is cheaper than reconciling two later.
- Gotcha: schema-constrained decoding does not mean the *values* are usable. First run
  on the real model returned `description` as a verbatim Spanish copy of the evidence,
  because "write the description in English" reads as satisfiable by translating. The
  fix was an explicit negative in both the system prompt and the property description
  ("never a copy of the evidence line"), which produced proper English summaries.
- The `description` fields inside the JSON Schema are prompt, not documentation — the
  model sees them. Spelling out what each priority level means there moved the model
  off "everything is none" more than the system prompt bullet did.
- Gotcha: `num_ctx` is the whole story on long files. Ollama's default window silently
  truncates and the model still answers fluently, so the failure looks like a bad model
  rather than a lost tail — which is why the AC pins it and why the code grows it from
  `approxTokens` rather than trusting one constant.
- Evidence comes back near-verbatim, not always exactly: the model trims a leading
  clause off the quoted line. Not worth enforcing by matching against the transcript —
  the quote is shown read-only next to the task and the user judges it.
- `OLLAMA_URL` is read at module load, so anything testing this has to set the env var
  before importing the module.
- Testing gotcha: these modules can be exercised without Next. `npx tsc <files>
  --module commonjs --moduleResolution node --outDir /tmp/...` then plain `node`
  against a stub server covers the request shape and every error path in seconds;
  the real model is then only needed to check answer quality.
---

## 2026-08-09 - US-011

**Implemented**
- `lib/extractors/claude.ts`: `extractWithClaude(transcript, meta, apiKey)` returning the
  same `ExtractedTask[]` as the Ollama extractor. It POSTs to the Anthropic Messages API
  (`ANTHROPIC_API_URL`, default `https://api.anthropic.com/v1/messages`, overridable so it
  can be pointed at a stub like `LINEAR_API_URL`) with `x-api-key` and
  `anthropic-version: 2023-06-01`, model `claude-sonnet-5`, structured output through
  `output_config.format` = `{ type: 'json_schema', schema: TASKS_JSON_SCHEMA }`, and no
  `temperature`/`top_p`/`top_k`. `SYSTEM_PROMPT`, `buildUserPrompt` and `normalizeTasks`
  come from `./task`, so the two providers share one schema and one type. A 401 throws
  «La API key de Anthropic no es válida»; any other non-2xx carries Anthropic's own
  message through; `stop_reason: 'refusal'` and `'max_tokens'` are checked before the
  content is read; every failure is an `ExtractionError`, already mapped to 502 by
  `describeError`.

**Files changed**
- `lib/extractors/claude.ts` (new). No other file needed touching — the shared module and
  the 502 mapping both landed with US-010.

**Verification**
- `pnpm typecheck` passes. `pnpm build` passes with only the pre-existing
  `lib/transcripts.ts` fs-tracing warnings (App Route + Server Component traces only).
- Compiled to CommonJS and ran against a stub HTTP server — 40 assertions, all passing:
  the request is a POST to `/v1/messages` with the three headers, `claude-sonnet-5`, the
  schema byte-for-byte equal to Ollama's and the shared system/user prompts, and with
  none of the three sampling parameters present; a thinking block before the text block
  is skipped; `{tasks:[...]}` and a bare array both parse; an empty title is dropped and
  `priority: 'HIGH'` normalises to `high`; `{tasks:[]}` returns `[]` rather than throwing;
  an empty key throws without making any HTTP call; 401 says the key is invalid; 429
  forwards «rate limited» with the status and model; a non-JSON error body still throws;
  a refusal throws naming the `stop_details.category` **even though the body also carried
  a parseable `{"tasks":[]}`**; `max_tokens` reports truncation; thinking-only content,
  prose instead of JSON, and an unreadable body each throw their own message; and an
  unreachable host throws «No se pudo conectar» without hanging.
- **Not verified against the real Anthropic API** — no `ANTHROPIC_API_KEY` in the
  environment and no `ant` CLI on this machine, so the live request shape (in particular
  that the API accepts `output_config.format` with this schema) is unconfirmed. It is
  written against the current structured-outputs docs, which state `format` takes exactly
  `type` and `schema` and that the JSON comes back in a `text` block.

**Learnings**
- The `format` object takes `type` and `schema` only — there is no `name` field, despite
  the SDK helper (`zodOutputFormat`) making it look like there might be. Confirmed
  against the structured-outputs docs rather than inferred from the TypeScript helper.
- Adaptive thinking is **on by default** on `claude-sonnet-5` when `thinking` is omitted
  (it is off by default on Opus 4.7/4.8), and thinking tokens are billed against the same
  `max_tokens` as the answer. That is why `MAX_TOKENS` is 16000 rather than something
  sized for the JSON alone, and why `stop_reason: 'max_tokens'` is a handled case instead
  of a parse failure. Left thinking on deliberately: the story's reason for this provider
  is answer quality, and deciding which lines are real commitments is the judgment part.
- Gotcha worth keeping: a refusal can arrive with HTTP **200** and a body that still
  parses. Checking `stop_reason` after parsing the content would have turned "Anthropic
  declined" into "this meeting had no action items" — the same silent-wrong-answer shape
  as Ollama's `num_ctx` truncation, one layer up.
- The stub-server harness from US-010 ports over unchanged: `npx tsc <files> --module
  commonjs --moduleResolution node --esModuleInterop --outDir /tmp/...` then plain `node`.
  Two additions: `--esModuleInterop` is required (`node:http`/`node:assert` have no
  default export otherwise), and `tsc` only resolves from the project directory, so pass
  an absolute path to the test file rather than `cd`-ing to it. `ANTHROPIC_API_URL` is
  read at module load like `OLLAMA_URL`, so switching endpoints mid-test means busting
  `require.cache`.
---

## 2026-08-09 - US-012

**Implemented**
- `app/api/extract/route.ts`: `POST /api/extract` taking `{ path }` and answering
  `{ tasks: ExtractedTask[] }`. It validates the path (`.md` only, same guard as
  `/api/transcript`), reads the note with `readTranscript(requireContextRoot(), relPath)`
  — so the body handed to the model has the frontmatter stripped and the title, date and
  attendees travel through `meta` instead — and dispatches on `getConfig().provider`:
  `claude` → `extractWithClaude(body, meta, claudeApiKey)`, otherwise
  `extractWithOllama(body, meta, ollamaModel)`. A missing Claude key throws
  `HttpError(400, 'No hay ninguna API key de Anthropic guardada…')` before any request is
  made, and a blank `ollamaModel` gets the same treatment for symmetry. Provider failures
  reach the client as 502 with the provider's own message, via the existing
  `ExtractionError` mapping in `describeError`.
- `lib/api.ts`: new `pathFromBody(request)` — the `POST` counterpart of `pathParam`,
  400 on a non-JSON body and 400 on a missing/blank `path`.

**Files changed**
- `app/api/extract/route.ts` (new)
- `lib/api.ts` (modified)

**Verification**
- `pnpm typecheck` passes. `pnpm build` passes with only the pre-existing
  `lib/transcripts.ts` fs-tracing warnings (App Route + Server Component traces only —
  no client component pulled node code in), and `/api/extract` shows up as a dynamic
  route.
- Exercised end to end against the running dev server (`localhost:3300`) with
  `OLLAMA_URL`/`ANTHROPIC_API_URL` pointed at one stub server, a scratch `.data/config.json`
  and a fixture transcript whose frontmatter carried a marker key:
  - success on both providers → 200 with the normalised task; the Ollama call went to
    `/api/chat` with `num_ctx: 32768` and `think: false`, the Claude call to
    `/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, `claude-sonnet-5`
    and `output_config.format`;
  - the user prompt contained `Title:`/`Date:`/`Attendees:` from `meta` and the body
    **without** the frontmatter block or its marker key;
  - stub returning 500 → 502 with «Ollama respondió 500 … («stub exploded»)» and
    «Anthropic respondió 500 …»;
  - `provider: 'claude'` with no key → 400 «No hay ninguna API key de Anthropic
    guardada…», blank `ollamaModel` → 400 «No hay ningún modelo de Ollama
    seleccionado…», both without touching the stub;
  - `{}` → 400, non-JSON body → 400, `.txt` path → 400, unknown file → 404,
    `../../etc/hosts.md` → 400 «La ruta sale de la carpeta de contexto», no context root
    → 400, `GET` → 405.
  - `.data/` did not exist before this run and was removed afterwards, so no local state
    was left behind.

**Learnings**
- Deciding the status for "nothing is configured" is the whole design of this route. Both
  extractors already throw `ExtractionError` for a missing key/model, which maps to 502 —
  correct for a provider that refused, wrong for a request that never left the machine and
  is fixed in /settings. The route therefore guards first and the extractors keep their
  guards as a safety net for direct callers; only one of the two answers is ever seen.
- The «excludes YAML frontmatter» AC needed no code: `readTranscript` already returns the
  split body. The thing worth testing was that nothing else re-introduced it, which a
  marker key in the fixture's frontmatter plus an echo stub proves in one request.
- A stub that records every request it receives (`/__seen`) and can be switched to failing
  (`/__mode`) covers both providers on one port, since they use different paths
  (`/api/chat` vs `/v1/messages`). Pointing `OLLAMA_URL` and `ANTHROPIC_API_URL` at it when
  starting `pnpm dev` is enough — both are read at module load, which works fine when the
  env var is set before the server starts.
- `next dev` answers 405 for an unimplemented method on an existing route handler, so
  there is nothing to write for "GET is not allowed here".
---

## 2026-08-09 - US-013

**Implemented**
- `lib/extract-client.ts`: `extractTasks(relPath)` — `POST /api/extract` with `{ path }`
  from the browser, same contract as `fetchFolder`/`fetchTranscript` (the route's Spanish
  message travels as the `Error`'s message; a body that is not `{ tasks: [...] }` is «El
  servidor devolvió una respuesta inesperada»).
- `app/use-task-drafts.ts`: `useTaskDrafts(relPath)` — the table's state for *every*
  transcript visited since the page loaded, kept in a map keyed by path so the edits are
  still there after browsing away and back. A row is `ExtractedTask & { id, include }`;
  `generate()` writes the answer under the path it was asked for, `updateRow`,
  `removeRow` and `addRow` act on the selected one. State per path is
  `{ rows, generating, error, extracted }`.
- `app/task-table.tsx`: the panel. Header with «Tareas», the `N de M seleccionadas`
  counter, «Añadir tarea» and «Generar tareas» (which reads «Generando…» and is disabled
  while the request is in flight). Per row: an include checkbox, an editable title, an
  editable description, a priority `<select>` over `PRIORITIES` with Spanish labels, the
  mentioned person and the evidence quote read-only, and a delete button. An extraction
  error renders as a `role="alert"` band *above* the table, which is left untouched.
- `app/explorer.tsx`: the drafts hook lives here (it outlives the selection) and the
  table is a full-width `h-[42dvh]` section under the three panels, rendered only when a
  file is selected.

**Files changed**
- `lib/extract-client.ts`, `app/use-task-drafts.ts`, `app/task-table.tsx` (new)
- `app/explorer.tsx` (modified)

**Verification**
- `pnpm typecheck` passes. `pnpm build` passes with only the pre-existing
  `lib/transcripts.ts` fs-tracing warnings — the traces are still App Route + Server
  Component only, so the three new client modules pulled no node code into the bundle
  (`lib/extractors/task.ts` is safe to import from a client component: its only import is
  `import type { TranscriptMeta }`).
- Driven in a real browser at `http://localhost:3300` (Playwright + Chromium) against the
  dev server with `OLLAMA_URL` pointed at a stub returning three tasks, a scratch
  `.data/config.json` and two fixture transcripts — 33 assertions, all passing:
  the panel appears only with a file selected; the button shows «Generando…» and is
  disabled during the call; three rows render with all boxes checked and the counter at
  «3 de 3 seleccionadas»; the evidence and the mentioned person render as text, not
  inputs; editing the title/description and switching the priority to «Urgente» works;
  unchecking → «2 de 3», deleting → «1 de 2», «Añadir tarea» → a blank checked row with
  priority `none` → «2 de 3»; navigating to the other transcript shows «Aún no hay
  tareas» and coming back restores every edit (title, priority, the unchecked row and the
  manual row); with the stub switched to failing, the inline alert reads «Ollama respondió
  500 al extraer con el modelo «stub-model» («el modelo se cayó»)» — the API's own message
  — with all three rows and their edits still on screen and the button usable again; and a
  successful retry replaces the rows with the model's.
- `.data/` did not exist before this run and was removed afterwards, so no local state was
  left behind.

**Learnings**
- Where the drafts live *is* the acceptance criterion. Holding them in the table means
  selecting another file unmounts it and the edits are gone; holding them in `Explorer`
  keyed by path is what makes «edits persist while navigating within the page» true, and
  it is also what US-014 needs to compare a table against the last extraction.
- The extraction is deliberately not re-run when the selection changes — the opposite of
  `useTranscript`, which reloads on every selection. Reading a file is cheap and its push
  history goes stale; an extraction costs minutes and money, so it only ever happens on
  the button.
- A failed regeneration must patch `{ generating, error }` and leave `rows` alone. Writing
  the whole state on failure is the easy bug here, and it throws away exactly the work the
  screen exists to protect.
- The table wants the full width, so it goes *under* the three panels rather than inside
  the transcript column: seven columns in the ~840px left over next to the tree and the
  file list is unreadable. The height stays definite (`h-[42dvh]` on the section, the
  panel row `min-h-0 flex-1`) — same rule as `app/page.tsx`: a `flex-1` child sized by its
  content never scrolls.
- Playwright gotcha for this repo: `getByLabel('Título')` matches by substring, so it also
  hits the `aria-label`s «Incluir tarea sin título» and «Eliminar tarea sin título» on the
  same row — `{ exact: true }` is required. The browser is driven with
  `/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs`
  (there is no local `playwright` dependency).
- Also: the inline error clears the instant a retry starts, so waiting for the alert to
  disappear proves nothing about the retry. Wait for the *rows* to change instead.
---

## 2026-08-09 - US-014

**What was implemented** — the regenerate guard. «Generar tareas» on a table that has
been edited by hand now opens a confirmation naming how many manual changes it would
discard; cancelling does nothing at all, confirming runs the extraction and starts the
count over.

- `app/use-task-drafts.ts`: `TaskDraftState` gains `baseline` (the rows as the last
  extraction returned them) and `confirming`. `countManualChanges(state)` diffs `rows`
  against `baseline` by row id into `{ edited, added, removed, total }`. `generate()` is
  now the guard — zero changes extracts straight away, anything else just sets
  `confirming` — and the extraction itself moved into a private `run(path)` shared by
  `generate()` and the new `confirmGenerate()`; `cancelGenerate()` clears the flag and
  nothing else. A successful extraction writes `rows` *and* `baseline` from the same
  array, so the count resets to 0; a failed one still patches only `{ generating, error }`.
- `app/task-table.tsx`: an amber «N cambios manuales» badge in the header next to the
  selection counter, and `<ConfirmRegenerate>` — a `role="alertdialog"` overlay inside the
  panel (the container is now `relative`) with «Cancelar» (autofocused, also bound to
  Escape) and a red «Descartar y regenerar». Copy: «La nueva extracción reemplaza la tabla
  completa. Se perderán 3 cambios manuales (1 editada, 1 añadida, 1 eliminada).»
- `app/explorer.tsx`: passes `onConfirmGenerate` / `onCancelGenerate` through.

**Files changed**
- `app/use-task-drafts.ts`, `app/task-table.tsx`, `app/explorer.tsx` (all modified)

**Verification**
- `pnpm typecheck` passes. `pnpm build` passes; its fs-tracing warnings still list only
  App Route + Server Component traces, so nothing node-only leaked into the client bundle.
  (There is no `lint` script in `package.json` — `pnpm lint` falls through to an unrelated
  global binary, so `typecheck` + `build` are the gates.)
- Driven in a real browser at `http://localhost:3300` (Playwright + Chromium) against the
  dev server with `OLLAMA_URL` pointed at a stub that can switch between two different
  task sets and counts how many extraction calls it received — 30 assertions, all passing:
  first extraction on a clean table shows no dialog and fires exactly one call; editing a
  title raises the «1 cambio manual» badge; pressing the button then opens the dialog with
  «Se perderá 1 cambio manual (1 editada)» *without* calling the provider; «Cancelar»
  closes it leaving the edited title, both rows, the badge and the call count untouched;
  deleting a row + adding one + unchecking a checkbox reads «3 cambios manuales» and
  «(1 editada, 1 añadida, 1 eliminada)»; Escape cancels like the button; confirming fires
  one call, replaces the two rows with the stub's three new ones, clears the badge and
  shows «3 de 3 seleccionadas»; regenerating again with nothing edited runs with no
  dialog; and with a dialog open, switching to the other transcript hides it (that file
  shows «Aún no hay tareas») while coming back restores both the dialog and the edit.
- The scratch `.data/config.json` and the `/tmp` fixtures were removed afterwards; `.data/`
  did not exist before this run and does not exist after it.

**Learnings**
- Counting changes by diffing against a baseline beats a `dirty` boolean for the reason
  the AC exists: the confirmation has to *name a number*, and a flag can only say «some».
  The diff is also self-correcting — typing a character and undoing it goes back to zero.
- Count rows, not edits. `onChange` fires per keystroke, so an incrementing counter would
  offer to discard «47 cambios» for one retyped title and the user would have no way to
  check the number against what is on screen.
- `include` has to count as an edit even though it is not one of the model's fields.
  Unchecking rows is the curation the panel exists for, and a regenerate wipes it exactly
  like a retyped title does.
- The `confirming` flag belongs in the per-path state, not in `TaskTable`: the table stays
  mounted across a selection change (only `selectedFile` changes), so component-local
  state would show a confirmation for file A while file B's rows are on screen.
- `run(path)` takes the path as an argument instead of closing over `relPath`. Both entry
  points into it already know the path, and it keeps the «the answer is written under the
  path it was asked for» rule from US-013 intact for the confirmed regeneration too.
- JSX gotcha met while writing the plural: text and an expression separated by a newline
  have the whitespace stripped, so `manual{n === 1 ? '' : 'es'}` across two lines happens
  to work but reads as a bug. Building the sentence in a helper and interpolating one
  string is the version that survives a formatter.
- Playwright: `getByText('1 cambio manual')` also matches the dialog's «Se perderá 1
  cambio manual», so badge assertions are only trustworthy while the dialog is closed.
---

## 2026-08-09 - US-015 Linear client: teams and projects

**What was implemented**
- `lib/linear.ts`: `LinearProject` / `LinearTeam` types and `listTeamsAndProjects(apiKey)`,
  built on the existing `linearGraphQL` helper — so the API key keeps travelling in
  `Authorization` verbatim (no `Bearer`) and GraphQL errors returned inside an HTTP 200
  body keep being detected by `graphqlError` and thrown as `LinearApiError`. Teams are
  paginated by cursor (`TEAM_PAGE_SIZE = 50`); each team's projects come nested
  (`PROJECT_PAGE_SIZE = 100`) and only a team that overflows that page costs a second
  `TeamProjects` query. Teams and projects are sorted by name (`localeCompare('es')`)
  because Linear's own order is unspecified and a dropdown should be stable.
- `app/api/linear/projects/route.ts`: `GET /api/linear/projects` → `{ teams }`, reading the
  key from `getConfig()` server-side exactly like `/api/linear/verify`, with a 400 +
  Spanish message when no key is stored. Everything else goes through `errorResponse`.

**Files changed**
- `lib/linear.ts` (modified), `app/api/linear/projects/route.ts` (new)

**Verification**
- `pnpm typecheck` passes. `pnpm build` passes, lists the new `ƒ /api/linear/projects`
  route, and its fs-tracing warnings still show only App Route + Server Component traces.
- Driven end to end against a stub Linear GraphQL server (`LINEAR_API_URL` pointed at it)
  with a scratch `.data/config.json` holding a fake key, over a deliberately awkward
  workspace — 51 teams (2 team pages) where team-0 owns 150 projects (nested page + 1
  follow-up query) named in reverse order:
  - 51 teams returned with `id`/`name`/`key`, 200 projects in total, team-0's 150 project
    ids all distinct (so the follow-up page is appended, not the first page refetched).
  - Teams and projects come out alphabetical; the reverse-named projects sort correctly.
  - The stub recorded exactly 3 requests, every one with `authorization: lin_api_STUBKEY123`
    — verbatim, no `Bearer` prefix.
  - A `{ data: null, errors: [...] }` body served with HTTP **200** → route answers
    `502 {"error":"Linear: Access denied to teams"}`.
  - No key stored → `400` with the Spanish «No hay ninguna API key de Linear guardada…».
  - Stub killed → `503` «No se pudo conectar con Linear…».
- The scratch `.data/` and the `/tmp` stub were removed afterwards; `.data/` did not exist
  before this run and does not exist after it.

**Learnings**
- The AC "GraphQL errors returned in a HTTP 200 body are detected" needed no new code:
  `linearGraphQL` (US-007) already checks the body *before* `response.ok`. Reusing it is
  what makes that guarantee automatic for every query added from here on — a hand-rolled
  `fetch` for the teams query would have quietly reintroduced the bug.
- Linear's nested connections are the trap: `teams { nodes { projects(first: N) } }` gives
  a *per-team* page, so a workspace with one big team looks complete while missing
  projects. The nested `pageInfo` has to be read per team, not once for the response.
- Sharing a cursor through module-scope state is a concurrency bug that manual testing
  cannot surface — one request per shell. Caught it by reading, not by running, which is
  the argument for keeping request-scoped data in return values on principle.
- `first` is capped at 250 by Linear; the page sizes here stay well under it so the single
  request that fills a dropdown does not become the slow one.
- The client-side helper (`lib/*-client.ts` pattern) is deliberately *not* added yet:
  nothing in the browser calls this route until US-017 builds the push panel, and the
  helper's error copy belongs with the component that renders it.
---

## 2026-08-09 - US-016 Linear client: create issue, with optional parent

**What was implemented**
- `lib/linear.ts`: `createIssue(apiKey, input)` on the `issueCreate` mutation, plus the
  `CreateIssueInput` / `IssueSource` / `LinearIssue` types and the exported
  `buildIssueDescription(description, source)`. Runs through the existing `linearGraphQL`
  helper, so the key still travels in `Authorization` verbatim and a GraphQL error inside
  an HTTP 200 body is still thrown as `LinearApiError` carrying Linear's own text.
- Priority is mapped through the `LINEAR_PRIORITY` record (none=0, urgent=1, high=2,
  medium=3, low=4), typed `Record<Priority, number>` so a new priority cannot be added to
  `lib/extractors/task.ts` without the compiler demanding its integer here.
- `projectId` / `parentId` are trimmed and only included in the mutation input when
  non-empty — an explicit `null` in `IssueCreateInput` is not the same as an absent key.
- The traceability block is appended after a `---` rule: `**Source:** <meeting> — <date>`,
  `**Mentioned:** <name>` when the transcript named one, and the evidence as a blockquote.
  Each field drops out when missing, and with nothing to say no block is appended at all
  (which is how the US-018 parent issue is created: same function, no `source`).

**Files changed**
- `lib/linear.ts` (modified)

**Verification**
- `pnpm typecheck` and `pnpm build` pass; the route list and the fs-tracing traces are
  unchanged (no client module reaches `lib/linear.ts`).
- Driven against a stub Linear GraphQL server (`LINEAR_API_URL` pointed at it), compiling
  `lib/linear.ts` with `tsc --outDir` first:
  - Full input → mutation carries `teamId`, trimmed `title`, `priority: 2`, `projectId`,
    `parentId` and the description with the block; returns `{ id, identifier, url }`.
  - All five priorities map to 0/1/2/3/4.
  - No project / parent / source → the input has neither `projectId` nor `parentId`.
  - `{ errors: [{ message: 'Team not found' }] }` served with HTTP **200** → 502
    «Linear: Team not found» (Linear's own words, not a generic failure).
  - `{ success: false, issue: null }` with no `errors` → 502 naming the task.
  - Blank `teamId` / blank `title` → 400 before anything leaves the machine.
  - `authorization` recorded as the key verbatim, no `Bearer`.

**Learnings**
- `issueCreate` can answer HTTP 200 with `success: false` and an empty `errors` array —
  Linear's payload flag is the real result, not the status. Checking `success !== true`
  before reading `issue` is what stops a failed push from being reported as created with
  an empty identifier.
- Linear's priority scale is ordered by urgency with 0 meaning «sin prioridad», so it is
  *not* the natural reading of our `PRIORITIES` order (which starts at `urgent`). Writing
  it as `Record<Priority, number>` turns that mismatch into a compile error instead of
  every task landing as `urgent`.
- Evidence is a verbatim quote and can be several lines; a Markdown blockquote only covers
  the line it prefixes, so every line gets its own `>`. Without it the second line breaks
  out of the quote and reads as part of the issue description.
- Spreading `...(projectId ? { projectId } : {})` rather than passing `projectId: null`
  matters for `parentId` in particular: a null parent is accepted, but keeping the key out
  makes «no parent» and «parent we failed to create» impossible to confuse at the call site.
- `node --experimental-strip-types` cannot load `lib/linear.ts` (its error classes use
  TypeScript parameter properties, `constructor(readonly cause?: unknown)`), so driving a
  lib module against a stub needs a `tsc --outDir /tmp/... ` compile first.
---

## 2026-08-09 - US-017 Push panel: project selector and parent task option

**What was implemented**
- `lib/linear-client.ts`: `fetchLinearTeams()`, the browser's side of
  `GET /api/linear/projects`, following the `*-client.ts` contract — the route's own
  Spanish message travels as the `Error`'s message, a well-formed body of the wrong shape
  answers «El servidor devolvió una respuesta inesperada», and `LinearTeam` arrives as a
  *type-only* import so `lib/linear.ts` never reaches the client bundle.
- `app/actions.ts`: `saveLastProject(projectId)`, a Server Action persisting
  `lastProjectId`. No `refresh()` (see learnings) and a swallowed write error, because a
  remembered preference must not become an unhandled rejection in an `onChange`.
- `app/use-push-target.ts`: `usePushTarget({ hasLinearApiKey, lastProjectId })` — loads the
  workspace once per page load, derives the initial selection (stored project if the key
  can still see it; otherwise the single team when there is only one), filters the project
  list by team, and persists every explicit project pick. `status` is
  `no-key | loading | ready | error`, so «there is no key» is not rendered as a failure.
- `app/use-push-options.ts`: `usePushOptions(relPath)` — `createParent` (default `true`)
  and `parentTitle`, keyed by path like the drafts.
- `app/push-panel.tsx`: the panel under the table. Team dropdown only when the workspace
  has more than one team, project dropdown, «Crear tarea padre» + its title input, and the
  button with `pushBlockedBy` deciding the single reason it is disabled — shown next to it
  (plus «Ir a ajustes» with no key, «Reintentar» on a failed listing).
- `app/explorer.tsx` / `app/page.tsx`: the panel wired under the table, with the page
  passing `hasLinearApiKey` (never the key) and `lastProjectId` from `getConfig()`. The
  table drops to `h-[38dvh]` to make room.

**Files changed**
- New: `lib/linear-client.ts`, `app/actions.ts`, `app/use-push-target.ts`,
  `app/use-push-options.ts`, `app/push-panel.tsx`
- Modified: `app/explorer.tsx`, `app/page.tsx`

**Verification**
- `pnpm typecheck` passes. `pnpm build` passes and its fs-tracing warnings still show only
  App Route + Server Component traces — no Client Component trace, so neither the store nor
  `lib/linear.ts` leaked into the bundle through the new Server Action import.
- Driven in real Chrome over CDP at `http://localhost:3300` against a stub Linear GraphQL
  server (`LINEAR_API_URL`) and a scratch `.data/config.json`:
  - Two teams, `lastProjectId: proj-b2` → team dropdown present, team **and** project
    preselected, «Crear tarea padre» checked, parent title = «Sync semanal de producto»
    (the transcript's title), button disabled: «Marca al menos una tarea para crearla.»
  - «Añadir tarea» → button enabled, note reads «1 tarea bajo una tarea padre».
  - Changing team → project cleared, options are the new team's, reason becomes
    «Selecciona el proyecto de destino.»; picking a project wrote
    `"lastProjectId": "proj-a1"` to the config, and a reload came back on it.
  - One-team workspace → no team dropdown, its projects listed straight away.
  - No key → «No hay ninguna API key de Linear guardada.» + «Ir a ajustes» link.
  - Stub killed → «No se pudo conectar con Linear…» + «Reintentar».
  - Emptying the parent title blocks the push; unchecking «Crear tarea padre» hides the
    input and unblocks it.
  - Parent title is per transcript: edited on note A, note B still prefills with its own
    title, returning to A shows the edit.
  - Panel fully visible with no page scroll at 1440×900, 1280×700 and 1024×640.
- The scratch `.data/`, the fixtures and the stub were removed afterwards; `.data/` did not
  exist before this run and does not exist after it.

**Learnings**
- A Server Action is the right shape for a *preference* mutation, but the settings-page rule
  «call `refresh()` after a successful mutation» does not carry over: the explorer holds the
  selection in client state, so refreshing would cost a round trip to re-render something
  already on screen. `refresh()` is for a page that *reads* the mutated config on the server.
- Prefilling an input from data that arrives asynchronously needs `null` (untouched) as a
  third state, not `''`. The transcript is fetched after the first paint, so a
  `useState(meta.title)` initialiser captures an empty title forever; `parentTitle ?? title`
  tracks the note as it loads and stops tracking the moment the user types — including when
  they type nothing, which an `||` fallback would silently overwrite.
- «The last project is saved whenever it changes» is not the same as «`projectId` changed».
  Changing team also clears the project, and persisting that would erase the memory of a
  perfectly good choice — only an explicit `selectProject` writes to the config.
- Disabling a button with three possible causes wants one function returning *the* reason,
  ordered by what has to be fixed first. Asking for a project while the key is missing, or
  while the listing is still in flight, is noise; `pushBlockedBy` returns a single string
  that is both the button's `title` and the text next to it, so there is one source for
  «why can't I press this».
- Chrome is drivable over CDP from plain `node` (Node 26 has a global `WebSocket`), so a
  browser check of a client-rendered panel needs no Playwright install: launch
  `--headless=new --remote-debugging-port`, read `/json/list`, then `Runtime.evaluate`.
  Setting a React-controlled input from the console needs the native value setter
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(...)`)
  before dispatching the event, or React sees no change.
- The Next dev-tools indicator sits in the bottom-left corner and overlaps the first control
  of a full-width bottom panel. It is dev-only, but it is worth knowing before reading it as
  a layout bug.
