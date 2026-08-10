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
