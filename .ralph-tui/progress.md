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
