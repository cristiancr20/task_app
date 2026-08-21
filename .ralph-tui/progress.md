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
- **Filesystem tests build a real temp tree.** `fs.mkdtempSync` under
  `os.tmpdir()`, fixtures written in `beforeAll`, `fs.rmSync` in `afterAll`, and
  a `chmod 000` case guarded by `it.skipIf(isRoot)` plus an assertion that the
  file really is unreadable (so the test cannot pass vacuously).

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
