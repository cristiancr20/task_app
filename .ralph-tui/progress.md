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
