# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

- **Filesystem scanning lives in `lib/transcripts.ts`.** Every path that comes
  from outside goes through `resolveInsideRoot` / `isInside(rootAbs, real)`;
  metadata is only ever built by `buildMeta`, never re-parsed elsewhere.
- **Limits are exported, commented constants with an options override.**
  `walkTranscripts(root, { maxDepth, maxFiles })` defaults to `MAX_WALK_DEPTH` /
  `MAX_WALK_FILES`, so tests can exercise a limit without building a huge tree,
  and the result carries explicit flags instead of truncating silently.
- **Server-side caches are a factory plus a shared instance.**
  `createTranscriptIndex({ walk, now, ttlMs })` in `lib/transcript-index.ts`
  takes its clock and its expensive call as options, and the module exports one
  instance (`getTranscriptIndex` / `refreshTranscriptIndex`) for the app — so
  the lifecycle is testable without global state or fake timers.
- **Text is matched on a folded copy, and positions are mapped back.**
  `lib/search.ts` folds a text character by character (lowercase, diacritics
  stripped, whitespace runs collapsed) while recording, for every unit of the
  result, the index it came from — plus a sentinel entry holding the original
  length. A hit over `[i, j)` of the folded text is therefore an exact
  `[offsets[i], offsets[j])` of the original, which is what lets a match be
  found accent-blind and still be highlighted on the text the user wrote. Any
  new accent-insensitive matching should reuse that shape rather than
  normalising the whole string and reusing the offset.
- **Shared client state that two parts of the page need is a provider, not
  props.** The header is written in `app/page.tsx`, a Server Component, so the
  search field there and the results inside `Explorer` share one hook through
  `app/search-provider.tsx` — a `'use client'` provider wrapping server-rendered
  children. Nothing else in the header had to become client code.
- **An async request's answer is written only if it is still the one being
  waited for.** `lib/search-state.ts` is a pure reducer whose state carries the
  `token` of the request it is showing; `resolved`/`failed` for any other token
  return the *same object*. «A late answer never overwrites a newer query» is
  therefore a unit test, not a story about the network — and the hook
  (`app/use-search.ts`) is left with nothing but the debounce and the fetch.
- **Local narrowing of a loaded list is a pure module, not a search.**
- `lib/file-filter.ts` filters the folder already in memory: it shares only
- `foldText` with `lib/search.ts` (one definition of «sin mayúsculas ni
- acentos») and owns nothing else — no debounce, no token, no minimum length,
- no request. It answers `{ query, active, files, total }`, giving the header
- both numbers for `3 de 20 archivos`, and returns the *input array itself*
- when nothing is filtered so the no-filter case reconciles no new list.
- **«Reset this state when that prop changed» goes in the render body.**
- `app/file-list.tsx` compares the `folder` prop against a `filteredFolder`
- state and clears the filter right there, so React re-runs the component
- before committing and the previous folder's filter never reaches the screen —
- cheaper and more explicit than an effect or a remounting `key`.

- **Two views over the same column are mutually exclusive, and each closes the
  other.** The header's search field and the inbox button both replace the
  centre column of the explorer. `InboxProvider` sits *inside* `SearchProvider`,
  so the inbox can read the search: the button empties the field when the inbox
  is opened, and an effect closes the inbox when the field has something in it.
  Explorer then renders `search.active ? <SearchResults> : inbox.open ?
  <InboxView> : <FileList>` and the button's `aria-pressed` is never a lie.
- **A pure module owns «what state is this note in», not the component.**
  `lib/inbox.ts` answers rows out of `TranscriptMeta[]` plus two lists of paths
  (pushed, drafted) and nothing else — no filesystem, no `node:`, no React — so
  the route builds the inbox on the server and the browser imports the same
  types and the same labels (`noteSizeLabel`) for the rows.
- **A selection is a set of ids, and every group action takes the *visible*
  rows.** `lib/inbox-selection.ts` holds `ReadonlySet<string>` of `relPath` and
  nothing else, so a reload, a filter or a push are set operations
  (`pruneSelection`, `selectVisible`, `deselectVisible`) rather than special
  cases in the view — and «seleccionar todo» is structurally incapable of
  reaching a row the filter is hiding, because the functions are only ever
  handed what is on screen. A cap is enforced on the way in by returning the
  *same set*, which costs no render and leaves the interface to explain why.
- **State that must not outlive a view lives in that view's hook, not in its
  component.** The inbox's filter and selection sit in `app/use-inbox.ts`
  because leaving the bandeja is `hide()` — called by the header button *and*
  by the search taking the column — so one function clears both. Kept inside
  `InboxView` they would survive as long as the component did and come back on
  the next open.
- **A long run is an async generator plus a pure fold, and the driver is
  whatever can reach the network.** `lib/extraction-queue.ts` sequences the
  tanda and yields events exactly like `lib/linear-push.ts` does for a push;
  `lib/extraction-queue-state.ts` folds those events into what the view draws.
  The push's generator lives on the server because it holds the API key, the
  queue's runs in the browser because both its steps are already routes — but
  the shape is the same, and «una nota que falla no detiene la cola» is a unit
  test over a generator with fake deps rather than a story about a model.
- **Derive the summary, never accumulate it beside the rows.** `queueTally`
  counts the tanda out of `notes` + `results`, so the line at the bottom
  («3 extraídas · 1 falló · 6 tareas») is structurally incapable of disagreeing
  with the chips on the rows above it. The run still emits its own `done` with
  the same three numbers — that is its contract with any other consumer — and
  the reducer uses it only to mark the run over.
- **State that must outlive a view lives in the component that outlives it.**
  The bandeja's filter and selection are cleared by `hide()` and so live in
  `useInbox`; the tanda must survive the search taking the column, so
  `useExtractionQueue` is called in `Explorer` — which is never unmounted — and
  passed into `InboxView` as a prop. «Navegar a otra vista no cancela la cola»
  is then a fact about where the hook is called, not a mechanism.
- **Cancelling a run of long steps stops the *next* step, not the current
  one.** The run reads `cancelled()` between notes: the extraction in flight has
  already cost its minutes, so it finishes and is stored («lo ya extraído se
  conserva») while nothing else is launched. That makes `cancelling` a status of
  its own — neither running nor finished — and the panel says so instead of
  pretending the stop was instant.
- **One builder for a result two paths produce.** `draftsFromExtraction` is what
  makes «se guarda exactamente igual que si se hubiera extraído a mano» a
  structural fact: both `useTaskDrafts` and the queue go through it, so the
  rows, the baseline, `extracted: true` and the three insight lists cannot drift
  apart between the two.
- **Filesystem tests build a real temp tree.** `fs.mkdtempSync` under
  `os.tmpdir()`, fixtures written in `beforeAll`, `fs.rmSync` in `afterAll`, and
  a `chmod 000` case guarded by `it.skipIf(isRoot)` plus an assertion that the
  file really is unreadable (so the test cannot pass vacuously).
- **Two narrowings compose in one order, and each count comes from its own
  level.** The bandeja is narrowed by *what has been done* to a note
  (`lib/inbox-scope.ts`) and then by *what was typed* (`lib/file-filter.ts`).
  The tabs count `InboxCounts` — the whole bandeja — the chip counts what is on
  screen against `counts.total`, and only the rows come from `filtered`. A tab
  that counted the filtered rows would read `Por revisar 0` over notes the
  filter is hiding: a way out that looks closed. For the same reason the strip
  holding the tabs is gated on the bandeja's total, never on the current tab's.
- **A list two views walk is defined once and derived twice.**
  `reviewQueue(items)` *is* `scopeItems(items, 'extracted')`, so «Por revisar»
  in the bandeja and the round in `app/review-nav.tsx` cannot disagree about
  what is left or about its order — and every event that moves the bandeja
  (extract, push, reload) moves the round with it, because there is only one
  list.
- **A fold hides the controls, never the decision.** The destination of a push
- collapses into `destinationSummary` — «A Plataforma · bajo «Comité de junio»»
- — and unfolds itself while `destinationSettled` is false, which is
- `pushBlockedBy` minus the rows: the form can never fold away the field the
- button is about to refuse over. The user's own click wins until completeness
- *flips*, decided in the render body like `FileList`'s filter, so a
- destination that has just lost its project comes back on screen by itself.
- **A footer is fixed by what is above it, not by being last.** The Linear
- column clips its last child when it runs out of room (`panel` is
- `overflow-hidden`), so the send button stays on screen because everything
- that grows — history, commitments, table, insights — is wrapped in one
- `min-h-0 flex-1 overflow-y-auto` box that takes the squeeze, with the table
- on a `min-h-40` floor so it is not the thing that vanishes instead.
- **A queue over a shrinking list wraps, and «where am I» is allowed to be
  nowhere.** `nextToReview` cycles: the round loses a note on every push, so
  its end is a moving target and a strict «last one» would strand whatever was
  skipped. `reviewPosition` answers `0` for a note that is not in the round —
  which is what finishing a review *makes* the open note — so the label switches
  from «Nota 2 de 3» to «Quedan 2» instead of inventing a place.
- **A tab with nothing behind it is disabled, and «cuál está abierta» is
  derived on every render.** `lib/column-tabs.ts` answers the whole header out
  of three numbers: the words, the counts, which tabs can be pressed and where
  an arrow key lands. `activeTab(counts, chosen)` is what the column draws, not
  `chosen`, so a pestaña that empties underneath the user — a re-extraction
  with no insights, a history still loading — falls back to «Tareas» in the
  same render instead of showing an empty panel once and correcting itself in
  an effect. The default tab is the exception that is never disabled: an empty
  table still carries «Generar tareas», so it is a panel with something to do
  rather than an empty one.
- **A block moved into a panel loses the caps it wore as a neighbour.** The
- insights and the pending commitments each capped and scrolled themselves
- (`max-h-64`, `max-h-56`) because the task table was directly below them and
- had to keep its height. Inside «La reunión» the table is in another pestaña,
- the panel is `overflow-y-auto`, and those caps become a scroll area inside a
- scroll area that traps the wheel halfway down. The same applies to the rules:
- a `border-b` and a `border-t` that each separated a block from the table read
- as one 2 px seam once the two blocks are adjacent.
- **A count that gates a panel counts everything the panel draws.** «La
  reunión» adds decisions, risks, open questions *and* the pending commitments
  of previous meetings into one number, because they are one panel: counting
  only the insights would disable a tab holding six commitments — the one thing
  the disabled rule must never do.

---


## 2026-08-19 - US-001
- Added `walkTranscripts(root, options?)` to `lib/transcripts.ts`: a
  breadth-first recursive scan of the context root returning `TranscriptWalk`
  (`files`, `truncated`, `depthLimitReached`, `fileLimitReached`).
- Same exclusions as `listFolder` (dotfiles, `node_modules`, non-`.md`) and the
  same metadata, built by reusing `buildMeta` — no duplicated parsing.
- Symlinks are resolved before being classified: one that lands outside the root
  is dropped by the existing `isInside` guard; a cycle inside the root is broken
  by a `Set` of already-queued real folder paths.
- Unreadable files (`readFileSync`) and folders (`readdirSync`) are skipped
  inside `try/catch` instead of failing the walk.
- New exported constants `MAX_WALK_DEPTH` (8) and `MAX_WALK_FILES` (5000),
  overridable per call through the options argument.
- Files changed: `lib/transcripts.ts`, `lib/transcripts.test.ts` (11 new tests).
- `pnpm typecheck` and `pnpm test` (22 files / 752 tests) pass.
- **Learnings:**
  - `fs.readdirSync(..., { withFileTypes: true })` describes the *link*, not its
    target: `entry.isDirectory()` / `isFile()` are both false for a symlink, so
    a walk that wants to follow links must `realpath` + `statSync` itself.
    `listFolder` never followed symlinked files for exactly this reason.
  - The realpath `Set` doubles as a dedupe: a symlinked folder that points at a
    folder already walked is skipped, so its notes appear once, under whichever
    path BFS reached first — worth knowing before asserting on relPaths in a
    test with two routes to the same folder.
  - `realpath()` in this module falls back to its input when the path does not
    exist, so a broken symlink passes the escape guard and is caught by the
    `statSync` `try/catch` instead.
  - Breadth-first (not depth-first) means the file cap keeps the shallow,
    top-level notes rather than whatever branch happened to be walked first.
---

## 2026-08-19 - US-002
- New `lib/transcript-index.ts`: an in-memory cache of `walkTranscripts` for the
  server. `createTranscriptIndex({ walk, now, ttlMs })` builds one; the module
  also exports a shared instance behind `getTranscriptIndex(root)`,
  `refreshTranscriptIndex(root)` and `invalidateTranscriptIndex()`.
- `get(root)` serves the cached snapshot while it is younger than
  `TRANSCRIPT_INDEX_TTL_MS` (30 s, commented against «a note dropped in the
  folder during a meeting should appear on its own»), and walks otherwise.
- Invalidation by root: the snapshot carries the `root` it covers, so a
  different configured folder never matches and forces a fresh walk. A walk in
  flight is only joined when it is a walk of the *same* root.
- `refresh(root)` is the explicit forced rebuild (the UI reload button): it
  never joins an in-flight walk, because that one may have started before the
  user pressed reload.
- Concurrency: the in-flight promise is stored and returned to later callers, so
  two cold requests produce one walk. Only the walk that is still the current
  `pending` may publish its snapshot, so an older walk finishing after a newer
  one cannot overwrite it. A rejected walk caches nothing and unblocks retries.
- Only metadata is cached — `TranscriptWalk` holds `TranscriptMeta`, never a
  body; a test asserts the exact key set of a cached file.
- Files changed: `lib/transcript-index.ts`, `lib/transcript-index.test.ts`
  (18 tests: build, reuse in window, expiry, ttl override, backwards clock,
  root change, invalidate, forced refresh, two cold callers, two roots, late
  older walk, failing walk, plus three over a real temp tree).
- `pnpm typecheck` and `pnpm test` (23 files / 770 tests) pass.
- **Learnings:**
  - `walkTranscripts` is synchronous, but the index's `get` is async on purpose:
    the promise is what a second concurrent caller can await, and it keeps the
    door open for a walk that yields. Cost is zero when the cache is warm —
    `Promise.resolve(snapshot)`.
  - A cache keyed by «the one configured root» does not need a `Map`: one
    snapshot plus a `root` field gives invalidation-on-change for free, and
    keeping a per-root map would hold the old folder's metadata alive for a root
    the app will not ask about again.
  - Guarding the publish with `if (pending === started)` is what makes «force a
    rebuild» safe to call at any moment; without it, a slow earlier walk can
    land on top of the fresher one it was racing.
  - Tests inject `now` rather than using `vi.useFakeTimers()`: nothing here
    schedules a timer, so a fake clock function is enough and the suite stays
    free of timer setup/teardown.
  - In a test harness type, `Omit<Options, 'now'> & { walk?: ... }` intersects
    the two `walk` signatures instead of replacing one — omit `'walk'` too.
---

## 2026-08-19 - US-003
- New `lib/search.ts`, pure logic with no `node:` imports: `prepareQuery`
  (normalises and refuses a query shorter than `MIN_QUERY_LENGTH`),
  `findMatches` (every occurrence in one field, with an excerpt for the first
  few), `searchNote` (title then body, one result or null) and `sortResults`.
- A match is located in a *folded* copy of the text — lowercase, without
  diacritics, whitespace runs collapsed — but the excerpt is cut from what the
  user wrote and the highlight travels as `{ text, start, end }`. No HTML is
  built anywhere, so nothing a note contains can reach the page as markup.
- New exported constants: `MIN_QUERY_LENGTH` (2), `MAX_MATCHES_PER_FILE` (5),
  `SNIPPET_CONTEXT_CHARS` (80), `MAX_SEARCH_FILES` (500), `MAX_SEARCH_RESULTS`
  (50), all overridable per call where a caller could need it.
- New `GET /api/search?q=`: metadata from `getTranscriptIndex`, bodies read one
  at a time through `readTranscript` (which keeps the root guard and the single
  frontmatter parser), answering `{ results, truncated }`.
- New `lib/search-client.ts` with `fetchSearch` and a shape guard that checks
  `date` as «string or null» and both highlight offsets as numbers — the UI
  slices `text` with them, so a wrong shape would mis-highlight rather than fail.
- Files changed: `lib/search.ts`, `lib/search.test.ts` (32 tests),
  `lib/search-client.ts`, `app/api/search/route.ts`.
- `pnpm typecheck` and `pnpm test` (24 files / 802 tests) pass.
- **Learnings:**
  - Normalising a whole string for search and then reusing the position is a
    bug waiting to happen: `normalize('NFD')` and `toLowerCase()` both change
    the length, so an offset found in the normalised text means nothing in the
    original. Folding character by character while recording where each
    resulting unit came from — plus a sentinel `offsets[length] = input.length`
    — is what makes «highlight the exact characters» possible at all.
  - Order matters in the fold: NFD, *then* strip the combining marks, *then*
    lowercase. Lowercasing first turns `İ` into `i` plus a detached mark, and
    «istanbul» stops matching «İstanbul». There is a test for it.
  - Collapsing whitespace inside the fold is what makes a phrase match across a
    line wrap («endpoint\nde pagos»), and it costs nothing extra because the
    offset map already handles a run of characters becoming one.
  - The excerpt is built as three collapsed pieces — before, matched, after —
    and the offsets are the lengths of the first two. Collapsing the whole
    excerpt in one pass and then looking for the match again would be a second
    source of truth.
  - `MAX_MATCHES_PER_FILE` caps the excerpts, never the count: the count is
    what the sort ranks on, so capping it would make a note that says the phrase
    forty times tie with one that says it five.
---

## 2026-08-19 - US-004
- Search UI, end to end: a field in the app header and a results panel in the
  column the folder's files normally occupy.
- New `lib/search-state.ts` (pure): `searchReducer` over
  `idle | searching | ready | error`, each non-idle state carrying the `token`
  of the request it shows; `highlightParts` (clamps the offsets that arrive
  over the network before slicing the excerpt), `leadMatch`, and
  `SEARCH_DEBOUNCE_MS` (250).
- New `lib/note-paths.ts` (pure): `folderOfNote`, `ancestorFolders`,
  `folderLabel`, `folderName` — the last two lifted out of `app/explorer.tsx`,
  which had private copies.
- New `app/use-search.ts`: query state, the debounce, the fetch and the
  increasing token. «Reintentar» skips the debounce through a ref, because it
  is a request the user just asked for by hand.
- New `app/search-provider.tsx` (context), `app/search-field.tsx` (Escape
  empties the field, then blurs; ✕ button; a spinner while searching) and
  `app/search-results.tsx` (result = title, date, folder, one excerpt with the
  hit in a `<mark>`, plus a `N coincidencias` chip; explicit `Buscando…`,
  `Sin resultados`, truncated notice and error + «Reintentar»).
- `app/explorer.tsx`: `openResult` lists and expands the whole ancestor chain of
  the result's folder, selects that folder and opens the note — without closing
  the search, so the next result is one click away and emptying the field lands
  on the folder of the note still open on the right.
- Files changed: `lib/search-state.ts`, `lib/search-state.test.ts` (26 tests),
  `lib/note-paths.ts`, `lib/note-paths.test.ts` (11 tests), `app/use-search.ts`,
  `app/search-provider.tsx`, `app/search-field.tsx`, `app/search-results.tsx`,
  `app/explorer.tsx`, `app/page.tsx`.
- `pnpm typecheck`, `pnpm test` (26 files / 839 tests) and `pnpm build` pass;
  `GET /api/search?q=pagos` answers over the real context folder and the header
  field is in the server-rendered HTML.
- **Learnings:**
  - The one testable part of a search box is not the box: the debounce belongs
    to the hook, but «which answer is allowed to be shown» is arithmetic over a
    token and moves into `lib/`, where the suite actually runs (only
    `lib/**/*.test.ts` is collected — there is no DOM in the test environment).
  - Returning the *identical* state object from the reducer when a stale answer
    arrives is worth doing deliberately: React bails out of the re-render, so
    dropping a late response costs nothing at all.
  - `type="search"` clears itself on Escape in some browsers and React never
    hears about it, which desynchronises the input from the query state.
    Handling Escape and calling `preventDefault()` is what keeps the two equal;
    the WebKit clear button is also hidden
    (`[&::-webkit-search-cancel-button]:appearance-none`) so there is one ✕.
  - Opening a result from a folder nobody has clicked needs the whole ancestor
    chain listed *and* expanded — `open()` per ancestor and one `setExpanded`
    — otherwise the tree ends up with a selection it cannot show.
  - Search replaces one column, never the page: because `selectedFile` is never
    touched when the field is emptied, «salir de la búsqueda sin perder la nota
    abierta» costs no extra state.
  - The offsets in a match are checked by `lib/search-client.ts` as numbers, not
    as a sensible pair, so the clamp in `highlightParts` is where a nonsense
    `[start, end)` stops being able to highlight the wrong characters.
---

## 2026-08-19 - US-005
- Quick filter over the listing of the selected folder, next to — and clearly
  distinct from — the header's global search.
- New `lib/file-filter.ts` (pure): `prepareFilter` (folds and trims what was
  typed; no minimum length, unlike `prepareQuery`), `fileMatchesFilter` (title
  or file name, folded on both sides, empty needle matches everything) and
  `filterFiles` → `{ query, active, files, total }` — the *same* array back
  when nothing is filtered, and `total` so the header can say `3 de 20`.
- `lib/search.ts` now exports `foldText(input)`, `fold(input).text` under a
  name: one definition of «sin mayúsculas ni acentos» for the whole app, with
  the offsets map left to the code that highlights.
- `app/file-list.tsx`: a filter strip under the panel head (funnel icon,
  ✕ button, Escape empties then blurs — the same habit as `SearchField`), the
  head chip switching between `20 archivos` and `3 de 20 archivos`, and a
  `NoMatches` panel («Ningún archivo coincide» + what was typed + a button that
  removes the filter) instead of a silently empty list. The field only appears
  once the folder is `ready` and has files.
- The filter empties itself on folder change through the render-time
  «adjust state when a prop changed» pattern (`filteredFolder` vs `folder`,
  new `folder` prop passed from `app/explorer.tsx`), not an effect.
- Files changed: `lib/file-filter.ts`, `lib/file-filter.test.ts` (26 tests),
  `lib/search.ts`, `app/file-list.tsx`, `app/explorer.tsx`.
- `pnpm typecheck`, `pnpm test` (27 files / 865 tests) and `pnpm build` pass.
  (There is no `lint` script in `package.json`; `pnpm lint` runs an unrelated
  binary from the PATH — typecheck is the check that matters here.)
- **Learnings:**
  - Filtering and searching look alike and are not: the filter needs no
    debounce, no token, no minimum length and no request, because its input is
    an array that is already in memory. Sharing the *fold* and nothing else is
    what keeps them consistent without making the filter pay for the search's
    machinery.
  - Returning the input array unchanged when the filter is empty is not a
    micro-optimisation but the thing that keeps `useMemo`'s output stable, so
    the common case (no filter) reconciles no new list at all.
  - «Reset this state when that prop changes» belongs in the render body
    (`if (folder !== filteredFolder) { setFilteredFolder(folder); setFilter('') }`),
    not in an effect: React re-runs the component before committing, so the old
    folder's filter never reaches the screen. A `key` on `<FileList>` would
    also work but would throw away the whole subtree on every folder click.
  - Stripping diacritics folds `ñ` to `n` too, so «manana» matches «mañana» —
    consistent with the search, and worth a test so it is a decision rather
    than a side effect.
---

## 2026-08-20 - US-006
- The inbox: every note under the context root that has never been pushed, as a
  view of its own reachable from the header.
- `lib/inbox.ts` (pure): `buildInbox({ files, pushed, drafted })` → rows carrying
  `relPath`, `title`, `date`, `folder`, `words`, `approxTokens` and a `status`
  of `untouched` | `extracted`; `inboxCounts`, the `byDateDescThenTitle`
  comparator (undated notes last, title as the tie-break) and `noteSizeLabel`
  (`840 palabras`, `1,2k palabras`, `18k palabras`, `sin texto`).
- `lib/store.ts#getPushedPaths` and `lib/drafts-store.ts#getDraftedPaths` are
  the two records the definition of «sin procesar» is built from. `getPushedPaths`
  reads `history` directly rather than `getPushSummaries`, so a push that
  created no issue still counts as a push and does not put the note back.
- `app/api/inbox/route.ts` (`GET /api/inbox`, `?refresh=1` forces the walk) reads
  the cached index plus the two local files — no transcript body is opened —
  and answers `{ items, truncated, scanned }`.
- `lib/inbox-client.ts` (`fetchInbox({ refresh })` + response guard),
  `lib/inbox-state.ts` (token reducer: rows survive a reload, a failed reload
  keeps `loaded` and the previous list), `app/use-inbox.ts` (loads once on
  mount so the header can carry the count), `app/inbox-provider.tsx`,
  `app/inbox-button.tsx` (header toggle with the pending count) and
  `app/inbox-view.tsx` (the list itself).
- The view words each of its states: `Buscando notas sin procesar…`, an error
  with «Reintentar», `Bandeja vacía` vs `No hay notas` for the two ways of
  having nothing, a warning when the walk was truncated, `1 con borrador · 17
  notas en la carpeta`, a `Con borrador` badge on the started notes, and a
  reload control in the panel head that forces a fresh walk.
- Clicking a row calls the explorer's `openResult`, so a note in a folder nobody
  has clicked opens with its whole ancestor chain listed and expanded; the inbox
  stays open, which is what makes working through it possible.
- A finished push calls `reload()` on the inbox from `onPushed`, so the header
  count stops including a note the moment it is processed.
- Files changed: `lib/inbox.ts`, `lib/inbox.test.ts` (25 tests),
  `lib/inbox-state.ts`, `lib/inbox-state.test.ts` (11 tests), `lib/inbox-client.ts`,
  `lib/store.ts` + `lib/store.test.ts`, `lib/drafts-store.ts` +
  `lib/drafts-store.test.ts`, `app/api/inbox/route.ts`, `app/use-inbox.ts`,
  `app/inbox-provider.tsx`, `app/inbox-button.tsx`, `app/inbox-view.tsx`,
  `app/explorer.tsx`, `app/page.tsx`.
- `pnpm typecheck`, `pnpm test` (29 files / 912 tests) and `pnpm build` pass.
  Also driven in a real browser against the configured root (17 notes, 15
  pending): open, row click, reload, and the search taking the column back.
- **Learnings:**
  - «Sin procesar» has to be defined against the *history*, not against the push
    summaries: a push that created no issue is still a push, and using
    `getPushSummaries` would have quietly put those notes back on the pile.
  - Drafts are a status, not an exit: a note with an extraction pending review
    is still unprocessed, so it stays in the list with a badge instead of being
    filtered out. Filtering it would hide exactly the work that is half done.
  - The count belongs on the header button, which is why `useInbox` loads on
    mount rather than on first open — a button that only learns the number after
    being pressed cannot answer «¿me queda algo?». The request is cheap (one
    cached walk, no bodies) and it warms the index the search is about to use.
  - `loaded` and `loading` are separate booleans on purpose: `loaded` is what
    tells «bandeja vacía» from «todavía no se ha preguntado», and rendering a
    `0` before the first answer would say the opposite of the truth.
  - The row's meta line must not wrap. With `flex-wrap` in a 20-rem column the
    size dropped to a second line and left a `·` dangling at the end of the
    first; one line with the folder as the only shrinking part is what makes
    every row the same height.
  - Spotted while driving the page, unrelated to this story: opening a note
    whose Markdown contains a bare URL inside a link logs
    `<a> cannot be a descendant of <a>` from `app/markdown.tsx` — the autolinker
    runs inside link text. Worth its own fix.
---

## 2026-08-20 - US-007
- Multiple selection in the inbox: a checkbox per row, «seleccionar todo» over
  the visible rows, an action bar with the count, and a ceiling per tanda.
- New `lib/inbox-selection.ts` (pure): a selection is a `ReadonlySet<string>` of
  `relPath`s and nothing else. `selectionSummary` (counts, the three states of
  the master checkbox, `remaining`/`atLimit`), `toggleSelected`, `selectVisible`,
  `deselectVisible`, `pruneSelection`, `selectedItems`, `selectionCountLabel`,
  `selectionLimitLabel`, `EMPTY_SELECTION` and `MAX_BATCH_SELECTION` (25,
  commented against US-008: the batch is extracted one note at a time against a
  possibly local model, so the ceiling is about how long a tanda a person can
  start and wait for). Every function returns the input set when it changes
  nothing.
- Every group function takes the *visible* rows, so «seleccionar todo» can never
  reach what the filter is hiding — that rule is in the module, not in the view.
- The inbox got its own filter strip, which is what «solo alcanza a las filas
  visibles con el filtro puesto» is about: it reuses `filterFiles` from
  `lib/file-filter.ts` unchanged (it was already generic over
  `{ title, fileName }`, which `InboxItem` satisfies), so the fold is the app's
  single definition of «sin mayúsculas ni acentos».
- `app/use-inbox.ts` owns the filter and the selection — not the view — because
  leaving the inbox is `hide()`, which both the header button and the search
  call: `hide()` empties both. It also prunes the selection against the rows
  during render whenever `state.items` changes, so a note that a push took out
  of the inbox never survives in the count for even one frame.
- `app/inbox-view.tsx`: the head chip now switches to `3 de 15 pendientes`, the
  strip holds the filter field plus a `SelectAll` labelled with what it reaches
  (`Seleccionar las 12 filtradas` when filtering), rows are a `<div>` with the
  checkbox beside the open button instead of one big `<button>`, a full tanda
  disables only the *unticked* boxes, `NoMatches` explains an empty filter, and
  `SelectionBar` sits outside the scrolling area with the count, the notes that
  are outside the filter, «No seleccionar nada» and the limit message.
- Files changed: `lib/inbox-selection.ts`, `lib/inbox-selection.test.ts`
  (42 tests), `app/use-inbox.ts`, `app/inbox-view.tsx`, `app/explorer.tsx`.
- `pnpm typecheck`, `pnpm test` (30 files / 954 tests) and `pnpm build` pass.
  Also driven in a real browser over the configured root (15 pending): ticking
  rows, «seleccionar todo» reaching only the 12 the filter left, the bar saying
  `13 notas seleccionadas (1 fuera del filtro)`, and the selection gone after
  closing and reopening the bandeja. The limit was exercised the same way with
  `MAX_BATCH_SELECTION` temporarily at 3: the bar explained it, the unticked
  boxes went disabled, the ticked ones stayed usable, and the master box went
  indeterminate.
- **Learnings:**
  - A row that does two things cannot be one `<button>`. Opening the note and
    choosing it for the tanda are independent actions, and a checkbox nested in
    a button is invalid markup that the keyboard cannot reach: the row became a
    `<div>` holding a checkbox and a button, with the hover/selected background
    moved to the wrapper.
  - Enforcing the ceiling by *returning the same set* is what lets the UI be
    honest: the box does not tick, and the identity comparison React does means
    the refused click costs no render — but a refusal with nothing said reads as
    a broken checkbox, so the bar carries the explanation and the unticked boxes
    go `disabled`. The ticked ones must stay enabled or the limit has no exit.
  - `indeterminate` is a DOM property with no React prop: a group checkbox needs
    a ref and an effect, otherwise «algunas» is drawn exactly like «ninguna».
  - Counting the selection against the *visible* rows and against the whole set
    are two different numbers, and both are needed: the master checkbox is about
    the first, the action bar about the second — which is why the bar says
    `(1 fuera del filtro)` when they disagree instead of showing a count the
    ticked boxes on screen do not add up to.
  - Playwright's `check()` asserts the box ends up checked, so it fails on a
    «seleccionar todo» that legitimately stops at the limit. `click()` is what
    exercises a tri-state box.

## 2026-08-20 - US-008
- The batch extraction queue: from the bandeja's action bar, «Extraer N notas»
  runs the ticked notes **one at a time**, stores each result as that note's
  drafts, marks each row with how it went, and ends with a summary.
- New `lib/extraction-queue.ts` (pure): `runExtractionQueue(notes, { extract,
  store, cancelled })`, an async generator yielding `start` →
  `extracting`/`extracted`|`failed` per note → `stopped`? → `done`. Same shape
  and same `MAX_CONSECUTIVE_FAILURES = 3` as `lib/linear-push.ts`, with the
  reasoning restated for a provider rather than for Linear: one note can choke
  a model, three in a row is Ollama not running or a key that is wrong, and the
  remaining twenty would each cost a full timeout to fail identically.
- New `lib/extraction-queue-state.ts` (pure): the reducer the hook dispatches
  into (`started`, `event`, `cancelling`, `crashed`, `dismissed`), `queueTally`
  — the summary is *derived*, so it cannot disagree with the row chips — and
  every label (`queueProgressLabel`, `queueSummaryLabel`, `extractedTasksLabel`,
  `extractButtonLabel`). `crashed` settles a note left mid-extraction, like
  `usePushRun#settle`.
- New `lib/extraction-drafts.ts`: `draftsFromExtraction(result, nextId)` — the
  one place an `ExtractionResult` becomes a `DraftsState`. `useTaskDrafts` was
  changed to build its own extraction through it, which is what makes «igual
  que a mano» true rather than a coincidence.
- New `app/use-extraction-queue.ts`: the React half — `runExtraction` +
  `saveDrafts` as the run's two calls, a `cancelled` ref read between notes, a
  `running` ref so a second tanda cannot be launched on top of one in flight,
  and an `onExtracted(path, stored)` callback per note that lands.
- `Explorer` runs the queue (not `InboxView`, which is unmounted whenever the
  search or the folder takes the column back) and wires `onExtracted` to two
  things: `inbox.refresh()` — new, an index-cached reload, since only
  `drafts.json` changed — and `drafts.adopt(path, stored)`, also new, which
  writes the result into the open note's table as if it had been extracted
  there.
- `InboxView`: the selection bar gained the primary «Extraer N notas» button
  (disabled with a reason while a tanda runs) and a warning when the tanda
  would replace existing drafts; a new `QueueBar` below it shows «Extrayendo»
  with `QueueProgress`, «Cancelar»/«Cancelando…», and afterwards the summary
  with «Cerrar»; rows carry `En cola` / `Extrayendo…` / `N tareas` / `Falló`
  plus the error text under the failed row.
- `app/progress.tsx` gained `QueueProgress` and both bars now share `StepBar`.
- Files changed: `lib/extraction-queue.ts` + test (18), 
  `lib/extraction-queue-state.ts` + test (33), `lib/extraction-drafts.ts` +
  test (7), `app/use-extraction-queue.ts`, `app/use-task-drafts.ts`,
  `app/use-inbox.ts`, `app/inbox-view.tsx`, `app/explorer.tsx`,
  `app/progress.tsx`.
- `pnpm typecheck`, `pnpm test` (33 files / 1012 tests) and `pnpm build` pass.
  Also driven in a real browser against the configured root with a stub Ollama
  (`OLLAMA_URL` pointing at a local script; `.data/drafts.json` backed up and
  restored afterwards): a tanda of 4 with the second note failing ended
  «3 extraídas · 1 falló · 6 tareas» with the error on its row; leaving for the
  search mid-run and coming back showed «3 de 4» still going; cancelling after
  one note ended «1 extraída · ninguna falló · 2 tareas · 2 sin lanzar» with
  exactly one request having reached the stub; five notes against a stub that
  always fails stopped after exactly three; and a note open in the table filled
  its rows by itself when the queue reached it.
- **Learnings:**
  - The queue could not live in the bandeja's own hook. `useInbox` clears the
    filter and the selection on `hide()`, which is right for them and fatal for
    a tanda — so the queue is called from `Explorer`, the component that
    outlives every switch of the centre column. Where a hook is called *is* the
    lifetime rule; nothing else had to be built for «navegar no la cancela».
  - Cancelling between notes rather than aborting the request is what makes «lo
    ya extraído se conserva» true: an extraction in flight has already spent its
    minutes against a local model, and throwing that away to feel responsive
    would be the most expensive kind of politeness. It costs a `cancelling`
    status, which the panel has to word — «se detendrá al terminar esta nota».
  - Storing is part of extracting. A result the app could not write is not
    «extraída» — the bandeja will not move the row and the drafts are not there
    — so `store` is awaited inside the note's own `try` and a failed save marks
    the note failed. Counting it as a success would be the one lie the summary
    could tell.
  - A re-read cannot adopt what the queue wrote. `mergeDrafts` deliberately
    lets what is on screen win over what comes back from disk (a slow read must
    not undo the user's typing), so calling `load` for a note the queue has just
    extracted would keep the stale, empty table. `adopt` writes the stored state
    in directly and records it as saved, which also stops the table's own
    write-behind from putting the empty version back.
  - Refreshing the bandeja after every note must *not* force the walk. What
    changed is `drafts.json`, which every `/api/inbox` request reads anyway;
    `reload()` would re-read the whole tree for a change that is not in the
    tree. Hence `refresh()` beside it — same request, cached index.
  - Testing «de una en una» needs a macrotask, not two `await Promise.resolve()`:
    the generator is several microtask hops away from its first `extract`, so
    the cheap flush asserts on a run that has not started yet. `setTimeout(0)`
    drains everything that is not genuinely blocked.
  - The row's two chips had to become one. A note the tanda just extracted is
    both «con borrador» and «3 tareas», and showing both says the same thing
    twice; the tanda's mark wins while the tanda is on screen, and «Cerrar»
    hands the row back to its status.
---

## 2026-08-20 - US-009
- Closing the tanda: the bandeja gained a third dimension — **which pile** — and
  the explorer gained a strip that walks the pile without going back to it.
- New `lib/inbox-scope.ts` (pure): `InboxScope = 'all' | 'untouched' |
  'extracted'`, `scopeItems` (returns the input array when nothing is narrowed),
  `scopeCount` over the `InboxCounts` the inbox already produces, and every word
  the tabs are drawn with (`scopeLabel`, `scopeTitle`, `scopeEmptyLabel`).
- New `lib/inbox-review.ts` (pure): the round. `reviewQueue` is *defined as*
  `scopeItems(items, 'extracted')`, so «Por revisar» in the bandeja and the
  round in the explorer are structurally the same list; `reviewPosition`
  (1-based, `0` for a note that is not in it), `nextToReview` (wraps, null when
  the only one left is the one open, starts from the top for a note that just
  left the round) and the two labels.
- New `app/review-nav.tsx`: `Nota 2 de 3 por revisar · sigue «X»` plus
  «Siguiente», at the top of the Linear column, drawn only while the round is
  non-empty. It sends nothing: the push stays one note, one panel, one review.
- `app/use-inbox.ts`: `scope`/`setScope`, applied *before* the text filter
  (`scopeItems` → `filterFiles`), and cleared by `hide()` like the filter and
  the selection.
- `app/inbox-view.tsx`: `ScopeTabs` (a radiogroup, each tab with its count read
  from `counts` rather than from the rows on screen), `EmptyScope` for a tab
  that is empty while the bandeja is not, and the counts re-derived — `pending`
  (= `counts.total`, what the header button shows), `inScope` (= `filtered.total`)
  and `items.length` — so the chip always compares what is on screen against
  every pending note.
- `app/explorer.tsx`: the round is derived from `inbox.state.items` (loaded on
  mount whether or not the panel was ever opened), «Siguiente» reuses
  `openResult`, and `onPushed` now calls `inbox.refresh()` instead of
  `reload()`.
- Files changed: `lib/inbox-scope.ts` + test (19), `lib/inbox-review.ts` + test
  (20), `app/review-nav.tsx`, `app/use-inbox.ts`, `app/inbox-view.tsx`,
  `app/explorer.tsx`.
- `pnpm typecheck`, `pnpm test` (35 files / 1051 tests) and `pnpm build` pass.
  Also driven in a real browser over the configured root, with three notes
  seeded as extracted and `.data/` backed up and restored byte-for-byte
  afterwards: the tabs read `Todas 15 · Sin tocar 12 · Por revisar 3`, the chip
  `3 de 15 pendientes`, opening a row brought its table up with its two rows,
  «Siguiente» walked 1→2→3→1 without touching the bandeja, and a push against a
  stubbed Linear (`LINEAR_API_URL` at a local script; parent + 2 tasks created)
  left the header at `14`, the tabs at `Todas 14 · Sin tocar 12 · Por revisar 2`
  and the strip at `Quedan 2 notas por revisar` — no reload.
- **Learnings:**
  - Two narrowings over one list have to be *ordered*, and the counts have to
    be taken from different places or they start lying. Scope first, text
    second; the tabs count `counts`, the chip counts `counts.total`, and only
    the rows come from `filtered`. Reading the tab from the filtered rows would
    have drawn `Por revisar 0` over four notes a filter was hiding — a way out
    that looks closed.
  - The strip that must not disappear is the one holding the way back. The
    filter strip was gated on `filtered.total > 0`; with a scope on top of it
    that is the count of the *current tab*, so an empty tab would have taken the
    tabs off screen with it. It is gated on `counts.total` now — the bandeja,
    not the slice.
  - «Siguiente» wraps on purpose. The round shrinks as notes are sent, so its
    end is a moving target; without wrapping, a note skipped near the top is
    reachable only through the bandeja, which is the trip the control exists to
    remove. Null then means one honest thing: «no queda otra».
  - `reviewPosition` returning `0` is a feature, not a fallback. Finishing a
    review *is* leaving the round — the push takes the note out of the inbox —
    so the very act of succeeding invalidates the position, and the label has to
    switch from «Nota 2 de 3» to «Quedan 2» rather than invent a place.
  - A `sr-only` radio inside its `<label>` is what a screen reader should hear
    for one-of-three, but Playwright's `check()` clicks the input and the label
    text intercepts the pointer. Clicking the *label* is both what a user does
    and what the test has to do.
  - The push's `reload()` was doing a full walk for a change that never touches
    the tree: it is `config.json` that gains the push. `refresh()` is the same
    request against the cached index, and it is what keeps the round and the
    bandeja in step the moment a note is sent — the same reasoning US-008 wrote
    down for the queue.
---

## 2026-08-20 - US-010
- The Linear column became a fixed frame around a scrolling middle: the
  destination folds into one line at the top, the button sits in a foot at the
  bottom, and everything that grows with the meeting is between them.
- New `lib/push-destination.ts` (pure): `Destination` (status, chosen project,
  `ParentPlan` and the parent title), `destinationSettled` — the rule the fold
  follows — `destinationSummary` («A Plataforma · bajo «Comité de junio»»), plus
  `pushBlockedBy`, `pushButtonLabel`, `pendingSummary`, `excludedSummary` and
  `pushOutcome`, all moved out of the panel where nothing could test them.
  `app/use-push-target.ts` now names its `PushTargetStatus` after
  `DestinationStatus`, so there is one list of the states the column can be in.
- `app/push-panel.tsx`: `PushPanel` keeps the head (title + the two chips, which
  are outside the fold on purpose) and the folding form; the new `PushFooter`
  holds the error, the outcome, the created issues (bounded, `max-h-24`), the
  single blocked reason and the button — replaced by `PushProgress` while the
  run is on. `destinationOf` is exported so both halves are drawn from the same
  answer instead of each deriving one.
- `app/explorer.tsx`: `parentApi`/`pushApi` built once and handed to both halves;
  history, commitments, table and insights wrapped in one
  `flex min-h-0 flex-1 flex-col overflow-y-auto` box with the table on a
  `min-h-40` floor, and `<PushFooter>` after it.
- `pnpm typecheck`, `pnpm test` (36 files / 1082 tests) and `pnpm build` pass.
  Also driven in a real browser against the configured root with Linear stubbed
  (`LINEAR_API_URL` at a local script: one team, two projects, a parent that
  takes 2,5 s and succeeds, a task that fails) and `.data/` backed up and
  restored byte-for-byte afterwards. Observed: the column opens folded on «A
  Plataforma · bajo «12June2026 next steps»» with the chip «1 tarea bajo una
  tarea padre» beside the title and the button 11 px off the bottom edge;
  emptying the parent title unfolds the form and the foot reads «Escribe un
  título para la tarea padre.»; clearing the project unfolds it again on «Sin
  proyecto elegido» / «Selecciona el proyecto de destino.»; during the run the
  foot reads «Creando 1 de 2…» with no button and the destination's `<select>`
  and checkbox carry `disabled`; after it, «0 tareas creadas · 1 fallida», the
  parent linked, «Reintentar 1 fallida», and the folded line switched to «bajo
  la tarea padre ya creada». At a 380 px viewport the button is still 11 px off
  the bottom and inside the viewport.
- **Learnings:**
  - A fold that hides a decision has to *be* the decision. The line is not
    «Destino» with a chevron, it is the answer — project and parent — so folding
    removes the controls and never the fact. That is also why the module answers
    «falta el título de la tarea padre» instead of leaving the line looking
    complete: an incomplete destination is exactly the one that must not fold.
  - «Empieza desplegada mientras falte algo» is one condition shared with the
    button, not a second opinion about it. `destinationSettled` is
    `pushBlockedBy` minus the rows, so the form can never fold away the very
    field the push is about to refuse over.
  - The fold follows completeness, and the user's click wins until completeness
    *flips* — the same render-body reset `FileList` uses for the folder filter.
    Remembering the click across a flip would leave a destination that just lost
    its project showing a folded line and no way to fix it.
  - A foot pinned by DOM order is not pinned. The section is `overflow-hidden`,
    so a column with no room left clips its *last* child — the button. What
    makes it fixed is that everything above it is one flex item with `min-h-0`:
    the squeeze is taken out of the middle, which scrolls, and the foot keeps
    its height. The table then needs a floor (`min-h-40`) or it is the part that
    disappears.
  - Two halves of one control must be computed from one value. `destinationOf`
    is called by the head and by the foot; without it the chip would say «bajo
    una tarea padre» while the button retried under a parent that already
    existed, because each would have re-derived «¿hay padre?» on its own.
  - Playwright's `isDisabled()` on an element that is not in the DOM waits the
    full timeout instead of failing fast, and a `.catch()` around it hides the
    30 s. Every assertion after it in the script is then about a run that
    finished long ago — the markup (`disabled=""` in `outerHTML`) is what
    actually answered «¿editable durante el envío?».
---

## 2026-08-20 - US-011
- The Linear column's five stacked blocks became three pestañas over one frame:
  the round strip on top, the tab row as the column's head, the open pile
  filling everything below it, and the action bar — destination fold plus the
  send button — pinned at the foot.
- New `lib/column-tabs.ts` (pure): `COLUMN_TABS` / `DEFAULT_COLUMN_TAB`,
  `columnCounts` (rows, `insightsCount` + commitments, `historyIssueCount`),
  `tabEnabled` («Tareas» always, the two reports only with something to
  report), `tabLabel` / `tabTitle` / `tabEmptyTitle`, `activeTab`,
  `columnTabViews` and the keyboard's `nextEnabledTab` / `edgeEnabledTab`.
  29 tests in `lib/column-tabs.test.ts`.
- New `app/column-tabs.tsx`: a real `role="tablist"` — roving `tabIndex`,
  arrows wrapping and skipping the disabled tabs, Inicio/Fin, `aria-selected`
  and `aria-controls` — that only draws `columnTabViews` and moves the focus.
- `app/explorer.tsx`: `chosenTab` in session state with the render-body reset on
  `selectedFile` («cambiar de nota vuelve a Tareas»), `tabCounts` memoised from
  the rows, the drafts' insights, the commitments and the history, and three
  `role="tabpanel"` bodies — the table alone in the first, `PendingCommitments`
  + `MeetingInsights` in «La reunión», `PushedHistory` in «Enviadas». Only the
  open one is mounted.
- `app/push-panel.tsx`: the destination block moved from the top of the column
  to just above the footer and its rule flipped (`border-t`), so destination
  and button read as one barra de acción. Nothing about the fold changed.
- `app/task-table.tsx`: the `<h2>Tareas</h2>` of its toolbar is gone — the
  pestaña says it and labels the panel through `aria-labelledby`. The chips
  («3 de 8», los cambios manuales, «Comprobando duplicados…») stay.
- Files changed: `lib/column-tabs.ts` + test, `app/column-tabs.tsx`,
  `app/explorer.tsx`, `app/push-panel.tsx`, `app/task-table.tsx`.
- `pnpm typecheck`, `pnpm test` (37 files / 1111 tests) and `pnpm build` pass.
  No browser driving this time: the Playwright MCP the previous stories used was
  not available in this session, so the layout claims here rest on the flex
  frame US-010 already verified — one `min-h-0 flex-1` panel between two
  `shrink-0` strips — and not on a screenshot.
- **Learnings:**
  - «Nunca es la pestaña inicial» and «no se queda abierta si se vacía» are the
    same rule, and it is cheapest as a derivation. Storing the resolved tab in
    state would need an effect per count change; `activeTab(counts, chosen)` in
    the render body answers both at every moment, and `chosen` stays what the
    user pressed — so a tab that fills up again comes back on its own.
  - The default tab cannot be count-driven. Every other tab is a report and an
    empty report is nothing to open, but an empty table is where the extraction
    is launched from — disabling it would take away the only way to fill the
    other two.
  - `panel-head` is an `@utility` that sets padding and gap, so a caller that
    needs its own is fighting Tailwind's ordering rather than reusing anything.
    The tab row writes the four properties out; `justify-between` on top of
    `panel-head` is fine precisely because it sets none of them.
  - Moving the destination to the foot is what makes «entre las pestañas y la
    barra de acción» true. Left where it was, the fold would have sat between
    the tab row and the panel it opens onto — a second header the tabs were
    supposed to remove — and the table's top would still not have been the tabs.
  - The tab and the panel must not say the same word. Once the pestaña reads
    «Tareas» and labels the panel, the table's own `<h2>Tareas</h2>` is the
    heading twice within a centimetre; what the tab cannot say — how many of the
    rows are actually going — is what earns the space instead.
---

## 2026-08-20 - US-012
- «La reunión» finished as a panel rather than as two blocks that happen to be
  in one. US-011 had already moved `PendingCommitments` and `MeetingInsights`
  into the pestaña and made `columnCounts` add the four things they draw, so
  this story was the panel itself plus the verification the criteria ask for.
- `app/meeting-insights.tsx`: dropped `border-t` (the commitments' `border-b`
  above it was already the separator, and the two together were a double rule)
  and the `max-h-64 overflow-y-auto` around the three lists — the pestaña
  scrolls now, so a second scroll area only steals the wheel. Docstring rewritten:
  the block is no longer «under the table», and its emptiness is half of what
  disables the tab.
- `app/pending-commitments.tsx`: `shrink-0` added (a flex child in a scrolling
  column was free to be squeezed), the `<ul>`'s `max-h-56 overflow-y-auto`
  removed for the same reason as above. `PREVIEW = 5` and «Ver todas» kept —
  they are still what stops thirty rows of old debt sitting between the user
  and this note's own decisions — but the comment no longer claims it is about
  the task table. `onOpenNote` untouched: `setSelectedFile`, exactly as before.
- `app/explorer.tsx`: the meeting panel's comment states the three facts the
  criteria are about — drawn here and nowhere else in the column, one scroll,
  and «tab deshabilitada» ≡ «no se dibuja panel» because `tabCounts.meeting`
  adds exactly the two blocks, so the branch is unreachable at zero.
- `lib/column-tabs.test.ts`: three cases for the gate — commitments alone open
  the tab, insights alone open it, and only all four empty close it (and
  `activeTab` falls back). 1114 tests.
- Verified read-only structurally: `grep` for `decisions|risks|openQuestions|
  insights` across `lib/linear-push.ts`, `lib/push-client.ts`,
  `app/use-push-run.ts` and `app/push-panel.tsx` returns nothing — the push
  counts `rows`, and nothing in this panel is a row. `MeetingInsights` /
  `PendingCommitments` have exactly one call site each, both in the meeting
  panel.
- `pnpm typecheck`, `pnpm test` (37 files / 1114 tests) and `pnpm build` pass.
  No browser driving: the Playwright MCP is still unavailable in this session,
  so the layout claims rest on the frame US-010 verified and on the markup, not
  on a screenshot.
- **Learnings:**
  - A block carries its neighbours in its CSS. Both of these were designed
    against the task table — a rule facing it, a cap so as not to push it — and
    moving them into a pestaña of their own left the countermeasures behind
    with nothing to counter. The tell is the pair: `border-b` on one and
    `border-t` on the other were each right alone and wrong together.
  - «La pestaña está deshabilitada y no se dibuja panel alguno» is not two
    checks. It is one identity — the count that gates the tab is the sum of
    exactly what the panel renders — and it holds because both components
    already returned `null` when empty. Anything drawn in that panel that does
    *not* return `null` when empty (a heading, an «aún no hay…» line) would
    break it silently, by making the disabled tab hide something.
  - A criterion phrased «sigue funcionando igual que hoy» is a request to prove
    a call site did not move. `onOpenNote={setSelectedFile}` — not `openResult`
    — is the whole answer, and it is worth a comment saying which one and why,
    because the round's opener is sitting three lines away in the same file.
---
