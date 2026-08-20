# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

### Widening what the model answers (`lib/extractors/task.ts`)

- A new list in the structured-output contract is a new property of the wrapper
  object the schema already has — never a second call, and never a second
  schema. The wrapper exists because Anthropic rejects a bare array at the root,
  and it is what lets one extraction answer four lists without either provider
  module changing beyond its return type.
- Stay inside the subset both providers accept: object at the root, every
  property in `required`, `additionalProperties: false`, and nullability as
  `type: ['string', 'null']` rather than `anyOf`.
- Normalising a new list mirrors the task rules instead of inventing its own:
  one field decides whether the entry survives (`text`, as `title` does), every
  string goes through `text()` so a model's numbers and booleans become strings,
  and an optional field is `text(v) || null` exactly like `mentioned`. That is
  what keeps «ambos extractores lo producen sin divergir» true for free.
- An absent list is empty, never an error: it is exactly what every answer from
  the previous prompt looks like, so «ausente = vacía» is what keeps an older
  model's answer a valid result.
- The bare-array-at-the-root fallback belongs to the tasks list *only* — that
  shape is what a model answers when it read the request as «give me the
  tasks», so reading it as anything else invents a list nobody sent.
- Route-side the lists are spread at the top level (`Response.json(result)`) so
  `tasks` never moves: a client that only reads `tasks` needs no change at all.
- A prompt rule for a new concept is stated as bluntly as the no-inventing rule
  for tasks, and says what the concept is *not* («a decision is not a task»,
  with the one sentence that carries both). A fabricated decision is worse than
  a fabricated task: nothing downstream reviews it before the user believes it.

### Linear GraphQL client (`lib/linear.ts`)

- Every list-shaped call follows the same shape: build the query with the page
  size interpolated, loop `for (let page = 0; page < MAX_PAGES; page++)`, read
  the connection with `readConnection(parent, key)`, map nodes through a
  `readX()` that returns `null` for a partial node, and `break` when
  `!hasNextPage || !endCursor`. `readConnection` already folds a missing cursor
  into `hasNextPage: false`, so the loop cannot spin on a stuck cursor.
- The first page must not send `after` at all — spread it conditionally
  (`...(after ? { after } : {})`); `after: null` asks Linear for a page before
  the first.
- Page sizes carry a comment justifying the number against Linear's
  multiplicative query-complexity budget; nested `pageInfo` is what blows it.
  Do not raise one without re-testing the exact query.
- Tests stub `fetch` with `stubFetch(reply)` in `lib/linear.test.ts`; `reply` is
  a function of the call, so it can answer forever (that is how the
  never-advancing cursor and per-batch responses are exercised). `MAX_PAGES` and
  the batch size are not exported, so tests mirror them as local constants.

### Widening a stored shape (`lib/store.ts`)

- A new field on something already on disk is added to `normalize*`, never to
  the discard guard: read it through `nullableString`, so an entry written
  before the field existed and one with a corrupt value both keep the record and
  read as `null`. Only the fields that make the record *be* what it is
  (`pushedAt`, `issues`) may drop it.
- `null` on such a field means «no consta», not «ninguno» — an old record and a
  record that genuinely has no value are indistinguishable, so anything
  filtering on it has to treat null as unknown.
- The writer takes an input type with the new fields optional
  (`HistoryEntryInput = Omit<T, 'new'> & Partial<Pick<T, 'new'>>`), so existing
  call sites compile unchanged and get the same `null` the normaliser gives.
- Test-side, the factory helper (`entry()`) defaults the new field to `null`:
  that is the pre-existing shape, and it leaves every test that is about
  something else untouched.

### Browser wrappers (`lib/*-client.ts`)

- One function per route, all built the same way: `fetch` inside a `try` whose
  `catch` throws «No se pudo contactar con el servidor de la aplicación.»,
  `const body: unknown = await response.json().catch(() => null)`, then
  `if (!response.ok) throw new Error(errorMessage(body))` — the route's own
  Spanish travels verbatim, with a per-call fallback for a failure that carries
  no text — then an `isX()` shape guard whose failure is «El servidor devolvió
  una respuesta inesperada.».
- Server types (`lib/linear.ts`, `lib/drafts-store.ts`) cross as `import type`
  only: those modules read `process.env` and the filesystem and must not reach
  the client bundle.
- Anything the browser must not be able to state — the API key, the ids of the
  issues a note created — is read server-side from `lib/store.ts`; the request
  carries the note path and nothing more.
- Tests stub `fetch` with a local `stubFetch()` that records `{ url, init }`,
  and cover: the URL/method/body actually sent, `cache: 'no-store'`, the happy
  answer, the route message passed through, both fallbacks (no text, not even
  JSON), a table of malformed shapes via `it.each`, and a rejected `fetch`.

### Per-note async state (`app/use-*.ts`)

- Anything fetched *about the selected note* is kept as
  `Record<path, { key, status, data, error }>` — the explorer never unmounts
  these panels, so one meeting's answer must not be read as another's. See
  `useDuplicateCheck`, `useIssueStates`.
- `key` is the round the request was made in (`${attempt}:${path}:${inputs}`).
  A `requested` ref of keys stops an effect re-run from re-asking; a `write`
  helper drops an answer whose key has since been replaced; and the entry is
  *read* only when `entry.key === requestKey`, so a superseded-but-valid answer
  is not rendered either. (`useDuplicateCheck` is exactly this; a hook that
  polls needs the two-key variant below.)
- Putting the inputs in the key is the invalidation: when what the request was
  computed from changes (a push adds issues to the history), the key stops
  matching and the effect asks again — no callback threaded through the tree.
- «Nothing to ask» — no API key, nothing to ask about — is a `status` of its
  own (`unavailable`), never an error: the UI it decorates renders exactly as
  it did before the feature existed. A failure is a discreet notice plus
  «Reintentar» *next to* the data, never in place of it.
- These hooks are not covered by the suite (it only collects `lib/**` and runs
  in `node`), so the arithmetic they display lives in `lib/` — see
  `lib/duplicate-check.ts`, `lib/issue-state-summary.ts` — and is tested there.

### A report about a whole folder (`useFolderIssueStates`)

- A panel that draws one badge per row asks *once* for the folder, never once
  per row: the route takes `{ paths }`, reads the config a single time, pools
  every id and lets `fetchIssueStates` batch them — see
  `app/api/linear/folder-issue-states/route.ts`.
- The cache is keyed by folder and its key carries what the answer was computed
  from (each note and how many issues it created), so a push in the folder on
  screen invalidates it by itself, as the ids do in `useIssueStates`.
- It is *read* without comparing the key, unlike the per-note hooks: the entry
  can only be a stale answer about these very notes, and dropping it while the
  next one travels would blink every badge in the list.
- A badge has no room for «Reintentar», so a failure here is silent by design:
  no key, no pushed note and a failed query all leave every row saying exactly
  what it said before the feature existed. That is the whole «sin hueco ni
  error» requirement, and it is why the decoration must never replace the fact
  it decorates — the count comes from the history and only *gains* the progress
  (`5 tareas` → `3/5 tareas`), so nothing ever renders a placeholder.

### Polling a per-note report (`useIssueStates`)

- A hook that re-reads its data on a timer splits the round key in two:
  `dataKey` (`${path}:${inputs}`) is what the entry is *about* and is what the
  render is allowed to read, `key` (`${round}:${dataKey}`) is which round asked
  and only decides whose answer may land. Reading by the round key — the
  US-003 shape — makes every tick blink the panel back to its loading text.
- The scheduling decision is pure and lives in `lib/` (`shouldRefresh` in
  `lib/issue-states-refresh.ts`), so the interval, the hidden tab and the
  «no overlap» rule are covered by the suite even though the hook is not.
- The cycle is one `setInterval` inside an effect keyed on
  `[enabled, relPath, tick]`: `enabled === false` means no timer and no
  listener exist at all, and changing note or unmounting tears it down. A
  `visibilitychange` listener stops it while hidden and, on return, ticks once
  before restarting so a stale report catches up.
- Overlap is prevented with a `useRef<Set<string>>` of paths with a request in
  flight, added synchronously as the request effect fires and deleted as it
  settles; freshness is stamped from when a request *started*
  (`useRef<Map<path, number>>`), never from when it answered.
- An error never replaces an answer already on screen: a failure over a `ready`
  report keeps the states and sets a separate `refreshError` footnote; only a
  report with nothing to show reads the failure as its `status`.
- A control whose label changes on every background round («Actualizar» ↔
  «Actualizando…») goes *outside* the `aria-live` region — otherwise a screen
  reader announces the polling rather than the news.

### A panel about the *other* notes of the folder (`app/pending-commitments.tsx`)
- The browser only ever holds the history of the note it opened
  (`GET /api/transcript`); anything about the notes *around* it needs
  `POST /api/history`, the folder-wide read that mirrors
  `/api/linear/folder-issue-states` — same `requirePaths` (now shared, in
  `lib/api.ts`), same «a note with no history answers `[]`», one `getConfig()`
  for the whole folder.
- It is a separate route on purpose: the history is a local file read that works
  with no Linear key, and folding it into the query that does need one would
  make the panel's data depend on another question's key check.
- A panel that decorates a meeting is *removed*, never emptied: no key → no
  states → no rows → no panel. That is what makes «sin API key no aparece» true
  by construction instead of by a third status.
- The early return on «nothing to show» goes *after* the hooks: the panel comes
  and goes as the project changes, and a conditional hook would take the fold
  state with it.
- One `Date.now()` per render, passed down to every row, so two commitments
  pushed together cannot read as «hace 1 semana» and «hace 2 semanas».
- A control whose list can grow («Ver todas») caps the list and stays *outside*
  the scroll area — otherwise the tasks below lose the column and the fold
  control scrolls away with the rows.

### Selecting across the whole history (`lib/pending-commitments.ts`)
- A rule about «what other notes still owe us» is a pure function over
  `Config['history']` + a `Record<issueId, IssueState>` (what `issueStatesById`
  already returns), never a query of its own: the states are already in the
  session cache, so the panel selects from what is known instead of asking again.
- `projectId: null` in a stored entry is «no consta» and not «ningún proyecto»
  (US-006), so anything filtering by project must drop the null bucket rather
  than adopt it — mixing two clients' commitments is the one mistake that is not
  recoverable by waiting.
- An issue with no known state is left out, not shown stateless: a row that
  cannot say what it is or how long it has been open is worse than no row. Note
  this is deliberately the opposite of `pushedProgress`, which counts an unknown
  issue as *not closed* — each module errs towards its own safe side.
- Dedup after the sort, never during collection: `Object.entries(history)` is
  insertion order, so an id reached twice must be pinned to the *oldest* push,
  which only the sorted list knows.
- A helper that lives in a server module (`titleFromFileName` in
  `lib/transcripts.ts`) is mirrored locally with a comment, not imported: these
  modules run in the browser, and `import type` is the only thing that may cross
  from `lib/store.ts` or `lib/linear.ts`.

---

## 2026-08-19 - US-001
- `fetchIssueStates(apiKey, ids)` in `lib/linear.ts`: asks Linear for the current
  state of issues by id, filtered server-side (`filter: { id: { in: $ids } }`),
  in batches of `ISSUE_ID_BATCH_SIZE` (= `ISSUE_PAGE_SIZE`, 50), each batch
  paginated with the existing `MAX_PAGES` pattern. Returns `IssueState`
  (`id`, `identifier`, `title`, `url`, `stateName`, `stateType`), with
  `IssueStateType` as our own union and any unknown value read as `unstarted`.
- Ids are trimmed and deduplicated; an empty (or all-blank) list returns `[]`
  without a request. Ids Linear no longer knows simply do not come back.
- Files changed: `lib/linear.ts`, `lib/linear.test.ts` (new `fetchIssueStates`
  describe block: single batch, several batches, pagination, stuck cursor,
  missing id, every state type, unknown/missing/non-string type, partial nodes,
  502/401 translation, no-network-on-empty).
- `pnpm typecheck` and `pnpm test` pass (466 tests).
- **Learnings:**
  - `readConnection(body, 'issues')` works straight off the `data` payload for a
    root-level connection — the duplicate-check queries only nest it because
    they scope by `project`/`team`.
  - The unknown-state fallback is a `find` over a `readonly IssueStateType[]`
    rather than a `Set`/`includes`, which keeps the narrowing to the union
    without a cast.
  - Deduplicating the ids matters because the same issue can appear twice in a
    note's history, and its copies could land in different batches — Linear
    would then return it once per batch.
---

## 2026-08-19 - US-002
- `POST /api/linear/issue-states` (`app/api/linear/issue-states/route.ts`): takes
  `{ path }` and answers `{ states }`. The path is validated with
  `requireMarkdownPath(await pathFromBody(request))`, `requireContextRoot()` is
  called because the history is keyed by a root-relative path, the API key is
  read from the config (400 in Spanish when missing, before Linear is touched),
  and the ids come from `getHistory(relPath)` — the browser never sends ids or
  the credential. A note with no history yields no ids, and `fetchIssueStates`
  answers `[]` without a request, so it is a 200 `{ states: [] }`.
- `lib/issue-states-client.ts`: `fetchIssueStates(relPath)` wrapper with
  `isIssueStates()`/`isIssueState()` shape guards, type-only import from
  `lib/linear.ts`, route text rethrown verbatim and its own fallback message.
- Files changed: `app/api/linear/issue-states/route.ts` (new),
  `lib/issue-states-client.ts` (new), `lib/issue-states-client.test.ts` (new:
  valid answer, path-only POST body, `no-store`, empty report, route message
  passed through, fallbacks for a body with no text and for non-JSON, eight
  malformed shapes, non-JSON 200, network failure).
- `pnpm typecheck` and `pnpm test` pass (483 tests, +17).
- **Learnings:**
  - The key check runs *before* the history read on purpose: «no key» is
    actionable in /settings, while an empty `{ states: [] }` would read as
    «nothing to report». The two acceptance criteria only disagree on a note
    that has neither, and US-003 does not query notes without history anyway.
  - The client guard checks `stateType` against the union, not just
    `typeof === 'string'`, because US-003 groups the counters by it — a value
    outside the union would be counted as nothing at all.
  - There is no `lint` script in `package.json`; `pnpm lint` falls through to
    whatever `lint` is on `PATH` (Android's, here). The quality gates are
    `pnpm typecheck` and `pnpm test`, as `AGENTS.md` says.
- **Reusable pattern:** every `lib/*-client.ts` wrapper is the same five steps —
  `fetch` in a `try` that rethrows «No se pudo contactar con el servidor de la
  aplicación.», `await response.json().catch(() => null)`, `if (!response.ok)
  throw new Error(errorMessage(body))` with a per-call fallback string, an
  `isX()` shape guard whose failure is «El servidor devolvió una respuesta
  inesperada.», then return the payload. Types cross from server modules as
  `import type` only.
---

## 2026-08-19 - US-003
- `lib/issue-state-summary.ts`: the grouping, pure and outside the component —
  `groupOfStateType` (six Linear state types folded into four buckets, with
  `triage`/`backlog` reading as `unstarted`), `summarizeIssueStates` (the four
  counters plus `total`, a repeated id counted once) and `issueStatesById` (the
  report keyed by id so the list does not scan it per line). `ISSUE_STATE_GROUPS`
  fixes the reading order: hechas, en curso, sin empezar, canceladas.
- `app/use-issue-states.ts`: the report keyed by transcript path, like the
  drafts and the duplicate check. The round key is `${attempt}:${path}:${ids}`,
  so (a) an answer is written only under the key it was asked for — a slow
  response for another note lands on its own key and is ignored — and (b) a
  push that adds issues to the history invalidates the report by itself,
  because the ids it was computed from are no longer the note's. Nothing else
  expires it: the cache is the session. `retry` is per path.
- No key or no history ⇒ `status: 'unavailable'`, and no request is ever made.
- `app/pushed-history.tsx`: `StateReport` under the header — counters with a
  coloured dot, only for groups anybody is in; «Consultando el estado en
  Linear…» while it loads; the route's own message plus «Reintentar» on
  failure. Every one of those states leaves the history below untouched. Each
  issue now carries Linear's own `stateName` at the end of its line and still
  links to Linear.
- `app/explorer.tsx`: `historyIssueIds` (memoised off the transcript's history)
  feeds the hook; `PushedHistory` gets the api as `states`.
- Files changed: `lib/issue-state-summary.ts` (new),
  `lib/issue-state-summary.test.ts` (new, 19 tests), `app/use-issue-states.ts`
  (new), `app/pushed-history.tsx`, `app/explorer.tsx`.
- `pnpm typecheck`, `pnpm test` (502 tests, +19) and `pnpm build` pass.
- **Learnings:**
  - Putting the note's issue ids in the round key is what makes «cachear
    durante la sesión» compatible with a push that happens *during* that
    session: no invalidation callback, no `refresh()` threaded through the
    explorer — the key stops matching and the effect asks again.
  - Reading the report through `byPath[relPath]?.key === requestKey` rather
    than `byPath[relPath]` is the second half of «no escribe sobre otra nota»:
    the `write` guard stops a stale answer from landing, and this stops a
    still-valid-but-superseded entry from being *rendered* for one paint.
  - The counters group by `stateType` and the per-issue line shows `stateName`
    verbatim on purpose: a workspace renames its columns, so only the type can
    be counted across workspaces, but «Listo para QA» tells whoever ran the
    meeting more than «en curso» does.
  - «0 canceladas» is noise on most notes, and a report where Linear knows none
    of the ids (`total === 0`) says nothing at all rather than four zeros —
    printing zeros would be a claim about issues nobody can open.
- **Reusable pattern:** a per-note async report is the same shape as
  `useDuplicateCheck` — `Record<path, {key, status, data, error}>`, a
  `requested` ref of round keys so an effect re-run does not re-ask, a `write`
  helper that drops an answer whose key was replaced, and a `status` that folds
  «nothing to ask» into `unavailable` rather than into an error.
---

## 2026-08-19 - US-004
- `lib/issue-states-refresh.ts`: the commented interval constant
  (`ISSUE_STATES_REFRESH_INTERVAL_MS = 60_000`, justified against what the
  report is for and against Linear's quota) and `shouldRefresh()`, the pure
  predicate every tick goes through — enabled (a note, a key, a history),
  visible, not already in flight, and one interval past the last *request*.
  A clock that has moved backwards reads as due rather than as fresh.
- `app/use-issue-states.ts`: the report now carries `dataKey` (note + ids, what
  the entry is about and what the render reads) apart from `key` (the round,
  what the write guard checks), so a background round no longer blinks the
  counters back to «Consultando el estado en Linear…». One `setInterval` per
  open note, started only when `enabled`, stopped on `visibilitychange` away
  and ticked-then-restarted on the way back, cleared on note change and on
  unmount. `inFlight` (a ref of paths) makes a tick skip rather than overlap;
  `askedAt` (a ref of path → ms) is stamped when a request leaves.
- A refresh that fails keeps the last good states and adds `refreshError`; only
  a report with nothing to show yet becomes `status: 'error'`. `retry` became
  `refresh`, since it is now both «Reintentar» and «Actualizar».
- `app/pushed-history.tsx`: «Actualizar» next to the counters (disabled and
  «Actualizando…» while a round runs), outside the `aria-live` region, plus a
  «· sin actualizar» footnote (the real message in its `title`) when the last
  refresh failed under a report that is still shown.
- Files changed: `lib/issue-states-refresh.ts` (new),
  `lib/issue-states-refresh.test.ts` (new, 12 tests), `app/use-issue-states.ts`,
  `app/pushed-history.tsx`.
- `pnpm typecheck`, `pnpm test` (514 tests, +12) and `pnpm build` pass.
- **Learnings:**
  - The single round key of US-003 could not survive polling: it is both «what
    this entry is about» and «who asked», and a refresh changes only the
    second. Splitting it is what lets the last good state stay on screen while
    the next round runs — which is also the whole of the «un fallo no borra el
    estado ya conocido» criterion.
  - «No overlap» has to be a ref, not state: the tick reads it inside a
    `setInterval` callback that closes over an old render otherwise, and it has
    to be written synchronously as the request fires, before any re-render.
  - Stamping freshness at request *start* rather than at answer is what stops a
    slow query from being followed immediately by another one.
  - The visibility listener is per note rather than global because it lives in
    the same effect as the interval — one subscription, one teardown, and no
    way to leave a listener pointing at a note that is no longer open.
  - `enabled === false` returning before anything is created is what makes «una
    nota sin historial no programa ningún refresco» true by construction rather
    than by a guard inside the tick.
---

## 2026-08-19 - US-005
- `app/api/linear/folder-issue-states/route.ts` (new): `POST { paths }` →
  `{ states: { [path]: IssueState[] } }`. Validates the list (`.md` only,
  deduplicated, empty is a 400), checks the key before the history exactly like
  the single-note route, reads the config **once** for the whole folder, pools
  every id of every note into one `fetchIssueStates` call and maps the answer
  back per path. Only paths travel; the ids and the key stay on the server.
- `lib/issue-states-client.ts`: `fetchFolderIssueStates(paths)`, the same five
  steps as every other wrapper, with `isFolderIssueStates()` checking each
  note's list item by item through the existing `isIssueState`.
- `lib/pushed-progress.ts` (new): `pushedProgress(issues, states)` — closed
  (done or cancelled, a repeated id counted once, capped at the total) out of
  the note's *own history*, and `done`. `null` means «nothing to say yet», which
  is what keeps the badge in its old form without a placeholder.
- `app/use-folder-issue-states.ts` (new): one query per folder, keyed by folder
  path, invalidated by the notes and their issue counts, read without a key
  comparison so the badges do not blink, and silent on failure.
- `app/file-list.tsx`: the badge now reads `3/5 tareas` once the states are in
  (`5 tareas` until then), wears `ok` instead of `warn` when everything is
  closed, and says the progress first in its `title` and to a screen reader.
- `app/explorer.tsx`: feeds the hook with the selected folder's files and passes
  `issueStates` to `FileList`. A push already refreshes that folder's listing,
  which changes the key and re-asks.
- Files changed: `app/api/linear/folder-issue-states/route.ts` (new),
  `lib/issue-states-client.ts`, `lib/issue-states-client.test.ts` (+18),
  `lib/pushed-progress.ts` (new), `lib/pushed-progress.test.ts` (new, 13),
  `app/use-folder-issue-states.ts` (new), `app/file-list.tsx`,
  `app/explorer.tsx`.
- `pnpm typecheck`, `pnpm test` (545 tests, +31) and `pnpm build` pass. The
  route was also exercised against the real config: notes with no history answer
  `{ states: { ...: [] } }` with no request to Linear, and two real notes came
  back in one query. The two badges were checked in the browser — amber
  «✓ 0/3 tareas» and, with the answer mocked as all-completed, green
  «✓ 3/3 tareas».
- **Learnings:**
  - The denominator has to be the note's history and not the size of the
    report: it is the number the row already showed, so a late answer *completes*
    the badge instead of rewriting it. It also errs the right way — an issue
    Linear has forgotten cannot be counted as closed, so the note reads as
    pending rather than as finished.
  - Cancelled counts as closed here although the note's own panel keeps it in
    its own bucket: the list answers «¿queda algo por volver?», and a task
    dropped on purpose is not something to come back to.
  - This is the first hook that reads its cached entry *without* comparing the
    request key. The per-note hooks must not render one note's answer under
    another's name; here the entry is already keyed by the folder it is about,
    so the only thing a key comparison would add is a blink.
  - A folder-wide route has to read `getConfig()` once: `getHistory` re-reads
    and re-parses `config.json` per call, which would be one file read per row.
  - `pnpm build` is worth running for a new route — it is what proves the route
    was registered (`ƒ /api/linear/folder-issue-states` in the route table).
---

## 2026-08-19 - US-006
- `lib/store.ts`: `HistoryEntry` gains `teamId: string | null` and
  `projectId: string | null`. `normalizeEntry` reads both through the existing
  `nullableString`, so an absent field and a field of the wrong type both land
  as `null` and the entry survives — only a missing `pushedAt`/`issues` still
  discards it.
- `addHistoryEntry` now takes a `HistoryEntryInput` (`HistoryEntry` with the two
  destination fields optional), so a caller that does not track the destination
  compiles and behaves exactly as before, with `null` stored.
- `app/api/linear/push/route.ts`: `recordingHistory` receives the validated
  `PushPlan` and writes `plan.teamId` / `plan.projectId` with the entry — the
  destination the issues were actually created under, not the raw body re-read.
- `lib/store.test.ts`: the `entry()` helper defaults to a null destination (the
  pre-US-006 shape). New tests: a push that names team and project, a push to a
  team with no project, a caller that names no destination, an old entry read
  back as unknown, an entry that has a destination, and an `it.each` table of
  wrong-typed destinations normalised to `null` without dropping the entry.
- Files changed: `lib/store.ts`, `lib/store.test.ts`,
  `app/api/linear/push/route.ts`.
- `pnpm typecheck`, `pnpm test` (554 tests, +9) and `pnpm build` pass. The real
  `.data/config.json` holds two entries written before this story, both with
  only `pushedAt`/`issues` — exactly the shape the new normalisation test pins.
- **Learnings:**
  - `null` here means «no consta», not «ningún proyecto». Both an old entry and
    a push to a team without a project read as `projectId: null`, so a future
    filter by project has to treat the null bucket as *unknown* rather than as
    «sin proyecto» — the two are indistinguishable in the stored history and no
    backfill can tell them apart.
  - Widening a stored type is a normalisation change, not a versioning one: the
    same `nullableString` that already tolerated a corrupt `contextRoot` is what
    makes an old entry survive. Adding the field to the discard guard
    (`typeof input.teamId !== 'string' → null` on the *entry*) would have
    silently emptied the existing history instead.
  - The optional-input type (`HistoryEntryInput`) is what keeps «sigue
    funcionando igual» true at compile time too, not just at runtime: without it
    every existing call site would have had to name a destination it does not
    know.
  - The test helper's defaults decide how much churn a new field causes — making
    `entry()` default to `null` left every test that is about something else
    (malformed issues, summaries, permissions) untouched.
---

## 2026-08-19 - US-007
- `lib/pending-commitments.ts` (new): `pendingCommitments({ history, states,
  notePath, projectId, titles })` → the open commitments of *other* notes pushed
  to the selected project, oldest first. Four rules, each documented against what
  it protects: no project selected → `[]` (never «todo lo abierto»); only entries
  whose `projectId` equals the selected one, so an old entry with `projectId:
  null` («no consta») stays out rather than mixing two clients; only issues whose
  `groupOfStateType` is neither `completed` nor `canceled`; and never the open
  note's own issues, which already have their own block.
- `states` is keyed by issue id — exactly what `issueStatesById()` already
  returns, so US-008 can feed it from the session cache (`Object.values(folder
  states).flat()`) without a new query. An id the map does not name is left out:
  either Linear forgot the issue or the answer has not landed yet, and a row that
  cannot say «cuánto lleva abierta / en qué estado» is worse than no row.
- Each item carries `issue` (the *live* `IssueState`, not the title frozen in the
  history), `notePath`, `noteTitle` and `pushedAt`. `titles` is an optional map
  the panel fills from the folder listing it already has; a note that is not in
  it falls back to its file name, undressed of extension and leading date by a
  local mirror of `titleFromFileName` (that helper lives in `lib/transcripts.ts`,
  which reads the filesystem and cannot be imported from the browser).
- Both `lib/store.ts` and `lib/linear.ts` cross as `import type` only, so the
  module stays browser-safe.
- `lib/pending-commitments.test.ts` (new, 27 tests): each rule on its own, the
  mixed history (old entry without project + another client's project + this
  project's), the four open state types and the two closed ones as `it.each`,
  ordering across notes, ties keeping the history's order, an id pushed twice
  listed once under the oldest push, a corrupt `pushedAt` sorting last, and the
  title fallbacks.
- Files changed: `lib/pending-commitments.ts` (new),
  `lib/pending-commitments.test.ts` (new).
- `pnpm typecheck` and `pnpm test` (581 tests, +27) pass. (`pnpm lint` is not a
  script in this repo — the name resolves to an unrelated binary on PATH.)
- **Learnings:**
  - Dedup has to happen *after* the sort, not during collection: `Object.entries`
    gives insertion order, so deduping while collecting would pin a repeated
    issue to whichever note happens to be stored first rather than to the oldest
    push — and «cuánto lleva abierta» is the whole point of the row.
  - The US-006 `null` = «no consta» reading is what decides the old-entries rule:
    since an old entry and a push to a team with no project are
    indistinguishable, the only safe move is to leave both out while a project is
    selected. Silence is recoverable; a commitment from another client shown to
    this one is not.
  - Excluding an issue with no known state is the opposite call to
    `pushedProgress` (which counts it as *not* closed) and both are right: there
    the safe side is «queda trabajo», here it is «no reclames algo que no puedes
    describir».
  - The four inputs the story names do not include the note titles, and the
    history only stores paths. An optional `titles` map keeps the signature
    honest — the caller passes the listing it already has — instead of making the
    pure module read from disk or the panel re-derive titles the file list
    already computed.
---

## 2026-08-19 - US-008
- `app/pending-commitments.tsx` (new): «Pendiente de reuniones anteriores» — one
  row per open commitment of a previous meeting of the selected project, with
  the `identifier` linked to Linear, the title, who the transcript put at the
  helm, «abierta hace 3 semanas» (exact date on hover) and Linear's own wording
  for the state next to the shared dot. The meeting it came from is a *button* —
  opening a note changes what this page shows, it does not navigate away — while
  the issue is a link: two questions, two destinations. It folds from its header,
  shows the five oldest with «Ver todas (N)», caps the expanded list at
  `max-h-56`, and renders nothing at all when there is nothing pending.
- `lib/store.ts`: `HistoryIssue` gains `mentioned: string | null`, read through
  `nullableString` in `normalizeIssue` — the four linkable fields still decide
  whether an issue survives, so an issue written before this keeps its place and
  reads as «no consta». `HistoryIssueInput` (and `HistoryEntryInput` carrying it)
  keeps every existing caller compiling.
- `app/api/linear/push/route.ts`: `recordingHistory` matches each `created` event
  back to the validated plan by row id and stores that row's `mentioned`. It is
  deliberately *not* added to the wire event: the browser already has the row on
  screen, and since the push assigns nobody in Linear, the history is the only
  place the name survives.
- `lib/pending-commitments.ts`: `PendingCommitment.mentioned`, taken from the
  stored issue while the rest of the row comes from the live state.
- `lib/elapsed.ts` (new): `formatElapsed(since, now)` — «hoy», «ayer», days,
  weeks, months (stopping at eleven so «hace 12 meses» never precedes «hace 1
  año») and years; `null` for a stamp that is not a date, «hoy» for one in the
  future.
- `app/api/history/route.ts` (new): `POST { paths }` → `{ history }`, the push
  history of a whole folder, one config read, no key required. `requirePaths`
  moved to `lib/api.ts` and is now shared with `/api/linear/folder-issue-states`.
- `lib/history-client.ts` (new): `fetchFolderHistory(paths)`, the usual five-step
  wrapper, validating each entry and each issue including the nullable
  destination and the nullable name.
- `app/use-folder-history.ts` (new): the same cache shape as
  `useFolderIssueStates` — keyed by folder, invalidated by «which notes and how
  much each has pushed», read without a key comparison, silent on failure.
- `app/issue-state-dot.tsx` (new): `StateDot` and the group→token map, extracted
  from `pushed-history.tsx` so the two panels that now show states side by side
  cannot drift apart. Colours are `bg-ok`/`bg-info`/`bg-muted` plus
  `bg-info-wash`/`text-info` for the panel — tokens only, no hex anywhere.
- `app/explorer.tsx`: feeds the pure module with the folder's history, the states
  the badges were already drawn from (`issueStatesById` over the folder cache),
  the open note, `target.projectId` and the titles from the listing — so the
  panel adds **no Linear query at all**. `onOpenNote` is `setSelectedFile`.
- Files changed: `lib/store.ts`, `lib/store.test.ts` (+8),
  `lib/pending-commitments.ts`, `lib/pending-commitments.test.ts` (+4),
  `lib/elapsed.ts` + `lib/elapsed.test.ts` (new, 24), `lib/history-client.ts` +
  `lib/history-client.test.ts` (new, 23), `lib/api.ts`,
  `app/api/history/route.ts` (new),
  `app/api/linear/folder-issue-states/route.ts`, `app/api/linear/push/route.ts`,
  `app/use-folder-history.ts` (new), `app/pending-commitments.tsx` (new),
  `app/issue-state-dot.tsx` (new), `app/pushed-history.tsx`, `app/explorer.tsx`.
- `pnpm typecheck`, `pnpm test` (640 tests, +59) and `pnpm build` pass, with
  `ƒ /api/history` in the route table. The route was exercised live against the
  real config: both real notes come back with their issues (`mentioned: null`,
  the pre-US-008 shape), a note with no history answers `[]`, and the shared
  guard answers «Falta el campo «paths»…» and «Solo se pueden leer archivos .md»
  from *both* folder routes. The panel itself was rendered to static markup with
  a throwaway harness (since deleted): an empty list produces no markup at all,
  one commitment produces every field the story asks for, and seven produce five
  rows plus «Ver todas (7)». It could not be checked in the browser: the real
  history predates US-006, so every entry carries `projectId: null` and the
  panel is correctly invisible, and fabricating a second pushed note would have
  meant writing into the user's context repo.
- **Learnings:**
  - «La persona que la transcripción puso al mando» was not answerable from
    anything stored: `mentioned` reached Linear inside the issue's *description*
    and was never kept. Widening `HistoryIssue` is the US-006 move again, and the
    same reading applies — `null` is «no consta», so a row drops the name rather
    than claiming the task is unowned.
  - Deriving it in the route from the validated plan, instead of adding it to the
    `created` event, left the wire contract and the whole client untouched: the
    browser has no use for a field whose row is already on its screen.
  - The states could be reused from the session cache but the *history* could
    not — it had never been sent for any note but the one open. That asymmetry is
    what the new route is for, and it is why that route needs no key: it answers
    from the config, not from Linear.
  - Scoping the panel to the selected folder is what makes «no vuelve a
    consultar» true: the list is a selection over exactly the states the badges
    already asked for, so opening a note costs one local file read and zero
    Linear queries. A pending commitment from a folder nobody has opened is a
    smaller loss than a burst of queries per note.
  - Extracting `StateDot` was not tidiness: two panels now report Linear states
    within a few pixels of each other, and a dot that meant `info` in one and
    something else in the other would be read as a difference in the data.
---

## 2026-08-19 - US-009
- The extraction now reads four things out of a transcript instead of one:
  tasks, decisions, risks and open questions, in a single model call.
- `lib/extractors/task.ts`: three new element types (`ExtractedDecision` with
  `decidedBy`, `ExtractedRisk` with `affects`, `ExtractedQuestion`), the
  `ExtractionResult` that carries the four lists, `emptyExtraction()`, three new
  arrays in `TASKS_JSON_SCHEMA` (all four now `required`), a second half of
  `SYSTEM_PROMPT` defining the three concepts, and `normalizeExtraction()` over
  a shared `normalizeList(payload, key, normalize)`.
- `lib/extractors/ollama.ts`, `lib/extractors/claude.ts`: both now return
  `Promise<ExtractionResult>` via `normalizeExtraction` — the only diff between
  them is still the HTTP.
- `app/api/extract/route.ts`: answers the result object spread at the top level
  (`Response.json(await extract(...))`), so `tasks` stays exactly where it was
  and `lib/extract-client.ts` — which only reads `tasks` — is untouched.
- `lib/extractors/task.test.ts`: +43 tests (702 total). Three suites, one per new
  list, plus a suite for the result as a whole: missing lists, lists present but
  not arrays, a payload with none of the four keys, a bare array at the root,
  and the extra keys a model adds beyond the contract.
- `pnpm typecheck`, `pnpm test` (702) and `pnpm build` pass. Exercised live
  against the real local provider (`qwen3:8b` on Ollama) with a synthetic
  transcript carrying one of each: constrained decoding accepted the widened
  schema and all four lists came back populated, `decidedBy: 'Ana'` and
  `affects: 'launch date'` included. The Anthropic side could not be run — the
  stored config has no `claudeApiKey` — so it rests on the schema staying in the
  same subset the tasks list already used.
- **Learnings:**
  - The wrapper object the schema already had (added because Anthropic rejects a
    bare array at the root) is what made this a one-call change: four lists are
    four more properties of the same object, so no provider code moved.
  - `normalizeTasks` was kept exported and unchanged rather than folded into the
    new function. It is the only list with a bare-array fallback — a root-level
    array is what a model answers when it read the request as «give me the
    tasks», so reading it as decisions would invent a list nobody sent — and
    keeping it separate left ~40 existing tests untouched.
  - Each new list drops an entry with no `text` the way a task with no `title` is
    dropped, and its second field (`decidedBy`, `affects`) is nullable through
    the same `text(v) || null` as `mentioned`. Reusing the task rules verbatim is
    what keeps «ambos extractores lo producen sin divergir» true for free.
  - The three new lists are missing from every answer a pre-US-009 prompt
    produced, so «ausente = vacía» is not defensive coding: it is what makes an
    older model's answer still a valid extraction.
  - Gotcha in the tests: a factory with `...overrides` cannot express «the key is
    missing» — `factory({})` still supplies it. That case needs its own test with
    destructuring (`const { text: _text, ...textless } = decision()`), which is
    exactly what the existing untitled-row test already did.
  - The closing line of `buildUserPrompt` is asserted with `endsWith` in the
    suite, so widening what the prompt asks for is a test change too.
---
