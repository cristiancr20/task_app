# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

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
