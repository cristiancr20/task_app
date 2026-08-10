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
- **Verifying a *successful* push without touching the real workspace:** point
  `LINEAR_API_URL` at a local stub that answers `organization`, `teams` and
  `issueCreate` (`node stub.js` + `LINEAR_API_URL=http://127.0.0.1:PORT/graphql
  npx next dev -p 3300`), and point `contextRoot` at a scratch folder with a
  sample note. The whole route runs for real — history included — and nothing
  reaches Linear. Back up `.data/config.json` first and restore it after; Next
  refuses a second dev server for the same directory, so the running one has to
  be stopped and restarted.
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


## 2026-08-09 - US-019 Push results summary and history persistence

The push now leaves a trace. When a run ends the panel lists every issue it
created as a link («STB-201 Preparar el informe mensual»), the parent first and
labelled «(tarea padre)», under the «N tareas creadas» line it already showed.
The route writes those same issues to `config.history[relPath]` as one entry per
push — `pushedAt` plus the created issues, never a failed one — so the
already-processed notice of US-009 shows them when the note is opened again, and
the preview re-reads itself as soon as the run ends instead of waiting for the
next visit.

**Files changed:**
- `app/api/linear/push/route.ts` — `recordingHistory()` wraps the run's event
  stream, collects `created` events and appends the history entry in a
  `finally`.
- `app/use-push-run.ts` — `createdIssuesOf()`; `usePushRun` takes an `onCreated`
  callback (through a ref) fired once a run that created something is over.
- `app/use-transcript.ts` — `refresh()`, a quiet reload that never blanks the
  panel.
- `app/push-panel.tsx` — the list of created issues; `parentCreated: boolean`
  became `parentIssue: PushedIssue | null` (the panel now links to it).
- `app/explorer.tsx` — wires `onCreated` → `refreshTranscript`, guarded by path.

**Learnings:**
- **The history is written by the server, not the browser.** Whatever the client
  fails to read — a closed tab, a dropped connection — still exists in Linear,
  and a lost entry means the next visit offers to create those issues a second
  time. Writing it in a `finally` around the event loop covers the abort, the
  unexpected throw and the cancelled stream alike, and costs nothing in the
  happy path.
- A `created` event is the only proof an issue exists, so collecting *those*
  (rather than the plan) is what makes «failed tasks are not written» true by
  construction instead of by filtering.
- Re-reading the note after a push needs a **quiet** reload: the normal one goes
  through `status: 'loading'`, which would swap the text the user is reading for
  a spinner to bring news about a notice. A quiet load only replaces what it
  has and swallows its own error.
- The callback that reloads must be compared against the *current* selection
  (`path === selectedFile`) — a run that finishes after the user moved on would
  otherwise re-read a different note.
- Gotcha: hooks whose callback outlives a render (`onCreated`) have to hold it in
  a ref, or `push` gets rebuilt on every render and an in-flight run calls a
  stale closure.

**Verified in the browser** (http://localhost:3300, no real workspace touched —
a stub GraphQL server on `LINEAR_API_URL` answered `teams`/`issueCreate`, with
the context root pointed at a scratch folder and the real config restored
afterwards): a push of 3 tasks with a parent, one of them refused, showed
«2 tareas creadas bajo la tarea padre · 1 fallida» with STB-200 «(tarea padre)»,
STB-201 and STB-202 linked; the notice appeared over the preview without
reloading; `config.json` held one entry with those three issues and not the
failed one; fixing the title and pressing «Reintentar 1 fallida» appended a
second entry (no second parent — the stub logged the retry hanging from
`issue-200`), and a full page reload plus reselecting the file showed «4 tareas
creadas en 2 envíos».

`pnpm typecheck` passes (no lint script in this project).

**Reusable pattern added to the top section:** run the app against a stub Linear
via `LINEAR_API_URL`.
---
