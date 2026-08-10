# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

- **Client fetch wrappers live in `lib/*-client.ts`.** One per route
  (`browse-client`, `transcript-client`, `extract-client`, `linear-client`,
  `push-client`). The route answers user-facing Spanish, so the wrapper throws
  `Error(thatText)` verbatim and the UI renders `err.message` without a second
  mapping. Each has an `isX()` shape guard; a body that fails it becomes «El
  servidor devolvió una respuesta inesperada.»
- **Types shared with the browser must not drag server modules in.** `lib/linear.ts`
  reads the API key and `process.env`, so client code imports its types with
  `import type`. When a *value* has to be shared (`PARENT_ROW_ID`, `isPushEvent`),
  it goes in a module that imports nothing but types — `lib/push-events.ts`.
- **Per-note UI state is keyed by transcript path, never a plain `useState`.**
  `useTaskDrafts`, `usePushOptions` and `usePushRun` all hold
  `Record<path, State>` because the panels are not unmounted when the selection
  changes — a plain state would show one meeting's results while another note is
  on screen. Async callbacks capture the path and write under it.
- **Long-running routes stream NDJSON, one JSON object per line.** Everything
  refusable is refused *before* the first byte (once the stream opens the status
  is already 200); per-item failures travel inside the stream. `ReadableStream`'s
  `pull` advances the work only when the consumer reads, so a navigation away
  stops it. The reader must buffer: a chunk is not a line.
- **Quality gate is `pnpm typecheck` only** (`next typegen && tsc --noEmit`).
  There is no lint script.
- **Verifying Linear UI without touching the real workspace:** mock
  `/api/linear/projects` with a bogus team id (shape needs `id`, `name`, `key`,
  `projects`) — the real push route then runs end to end and Linear rejects every
  mutation, so nothing is created. Mock `/api/linear/push` with a scripted NDJSON
  body to exercise the success rendering.

---


## 2026-08-09 - US-018 Push execution with progress, per-row status and retry

Implemented the push run end to end: `POST /api/linear/push` creates the parent
issue first when requested and then every selected task as a sub-issue of it,
one at a time, streaming an NDJSON event per step so the panel can say
«Creando N de M». A task that fails is reported against its own row and the run
continues; three consecutive failures abort it with an explanation that the
problem is not one task. Each row ends created (identifier linking to Linear),
failed (with Linear's own message) or pending, and the button turns into
«Reintentar N fallidas» that re-sends only what is not already created.

**Files changed:**
- `lib/push-events.ts` (new) — wire contract: `PushRequest`, `PushEvent`,
  `PARENT_ROW_ID`, `isPushEvent`. Type-only imports so it is safe on both sides.
- `lib/linear-push.ts` (new) — `runPush()`, an async generator yielding
  `start`/`creating`/`created`/`failed`/`aborted`/`done`.
- `app/api/linear/push/route.ts` (new) — validates the plan, reads the key and
  the meeting metadata server-side, streams the generator as NDJSON.
- `lib/push-client.ts` (new) — `pushTasks()`, line-buffered NDJSON reader.
- `app/use-push-run.ts` (new) — folds events into per-path run state; keeps
  created rows across retries; `parentIssueOf()`.
- `app/push-panel.tsx` — progress line, outcome, abort banner, button label.
- `app/task-table.tsx` — «Estado» column with the per-row outcome.
- `app/explorer.tsx` — computes pending/failed/created, wires the run.
- `lib/api.ts` — `describeError` reused for per-row failure text.

**Learnings:**
- The **parent** failing is the one failure that must stop the run: every task
  was meant to hang from it, and creating them loose in the project leaves a
  mess the user has to clean up by hand. A *task* failing must not.
- `MAX_CONSECUTIVE_FAILURES` must count *consecutive* failures, reset on every
  success. A total count would abort a long run that is merely 3-of-40 bad.
- A retry is the same push over what is left, not a separate action — so the
  created rows are dropped from the *request* in `explorer.tsx`, not skipped by
  the server. That is what makes «rows already created are never sent again»
  true by construction.
- Rows left in `creating` when the stream ends are settled as failed with «comprueba
  en Linear si la tarea se creó», not retried silently: a blind retry would
  duplicate an issue that may well have landed.
- The retry button counts what it is *about to send*, which is not always the
  failures — an aborted run also leaves untouched rows, hence «Reintentar 4
  pendientes» vs «Reintentar 2 fallidas».
- Gotcha: `route.fulfill`/mocked JSON needs an explicit `--content-type`, and the
  team shape guard requires `key` — a mock missing it silently reads as «respuesta
  inesperada».

**Verified in the browser** (http://localhost:3300, no real issues created — the
team id was mocked bogus so Linear rejected every mutation): progress advanced
«Creando 1 de 4…» → «3 de 4», the run stopped after 3 consecutive failures with
the systematic-failure banner, rows showed the error and the untouched row stayed
«Pendiente», the button became «Reintentar 4 pendientes»; with a scripted stream,
created rows rendered as TEST-201/TEST-202 links, the button became «Reintentar 2
fallidas», and the retry request carried only the two failed rows.

`pnpm typecheck` passes (no lint script in this project).
---
