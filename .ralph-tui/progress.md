# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

- **Colour never appears literally in the markup.** `app/globals.css` declares
  the house tokens once with `light-dark(light, dark)` — bg, surface, surface-2,
  line, line-strong, content, muted, accent, accent-soft, accent-wash,
  on-accent, ok/warn/danger/info + `-wash`, scrim — and `@theme inline` turns
  them into `bg-surface`, `text-muted`, `border-line`… Because `color-scheme`
  picks the side, **a new component needs no `dark:` variant at all**; there are
  zero left in `app/`. The canvas is `bg-bg`, panels `bg-surface`, chrome and
  inline code `bg-surface-2`; containers `border-line`, controls
  `border-line-strong`; anything selected is `border-accent bg-accent-wash`;
  primary actions `bg-accent text-on-accent hover:bg-accent-soft`. Errors are
  `danger`, success `ok`, warnings `warn`.
- **Two traps when adding a token.** (1) `--on-accent` is not white: white on
  the dark-side accent fails AA, so it is near-black there — recompute both
  sides if a tone changes. (2) A `dark:` pair only collapses into one token when
  both sides *mean* the same; a modal veil is dark in both themes, which is why
  it is `--scrim` and not `--content`. Opacity modifiers on a token are fine
  (`border-warn/30`): Tailwind wraps it in `color-mix()`, which accepts
  `light-dark()`.
- **A preference the server must know before the first paint lives in a cookie,
  split across three modules.** `lib/theme.ts` holds constants, the type and a
  guard and imports *nothing* (so a client component can use it);
  `lib/theme-server.ts` is `import 'server-only'` + `cookies()`;
  `lib/theme-action.ts` is `'use server'` and re-validates the value with the
  shared guard before writing. The root layout reads it and interpolates it into
  `<html>`, which is what removes the flash — no blocking script.
- **`import 'server-only'` works without installing the package**: Next aliases
  it to `next/dist/compiled/server-only`, and `tsc --noEmit` is happy. Use it on
  any `lib/` module a client component might import by accident.
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


## 2026-08-09 - US-020 Theme toggle: light, dark and system

The app is no longer locked to the OS theme. A three-state segmented control
(claro / oscuro / sistema, sun / moon / monitor glyphs) sits in the explorer
header, in the settings header and in the «elige una carpeta» card, writes the
choice to the `TASKS_APP_THEME` cookie through a server action, and the root
layout paints the resulting class on `<html>` — so the first byte the browser
gets already carries the right theme and nothing flashes. None of the 296
existing `dark:` utilities were touched.

**Files changed:**
- `lib/theme.ts` (new) — `THEME_COOKIE`, `THEMES`, `Theme`, `THEME_LABELS`,
  `isTheme()`, `themeClass()`. Imports nothing, so the client can use it.
- `lib/theme-server.ts` (new) — `server-only`; `getTheme()` reads the cookie and
  falls back to `'system'`.
- `lib/theme-action.ts` (new) — `'use server'`; `setTheme()` validates, writes
  the cookie (path `/`, one year, `sameSite: lax`) and
  `revalidatePath('/', 'layout')`.
- `app/globals.css` — `@custom-variant dark` (two branches), `color-scheme` on
  `:root` / `:root.light` / `:root.dark`, `--background`/`--foreground` moved to
  `light-dark()`.
- `app/layout.tsx` — now `async`; puts `themeClass(theme)` on `<html>`.
- `app/theme-toggle.tsx` (new) — the control, with `useOptimistic`.
- `app/page.tsx`, `app/settings/page.tsx` — `async`, read the theme, render it.

**Learnings:**
- **`@custom-variant dark (&:where(.dark, .dark *))` alone breaks «system».**
  With that one-liner, a user on «system» with a dark OS gets a *light* UI: no
  class means no `dark:` utility matches. The variant needs a second branch —
  `@media (prefers-color-scheme: dark) { &:where(:root:not(.light), :root:not(.light) *) }`
  — so the absence of a class hands the decision back to the OS. The
  `:not(.light)` is the part that keeps a forced light theme light on a dark
  machine. Tailwind 4 supports the block form of `@custom-variant` with `@slot`.
- **`color-scheme` and the `dark:` variant have to be driven by the same class,
  or they disagree.** Scrollbars and form widgets have no class to read; they
  follow `color-scheme`. Setting it three ways (`light dark` on `:root`, then
  `light` / `dark` on the two class selectors) also picks the side of every
  `light-dark()`, which is why `--background`/`--foreground` no longer need a
  `@media` block of their own.
- **`import 'server-only'` needs no dependency.** The package is not in
  `node_modules`, but Next ships `next/dist/compiled/server-only` and aliases
  the specifier; typecheck and dev both pass.
- Lightningcss polyfills `light-dark()` into `--lightningcss-light/dark` toggles
  and emits its own `@media (prefers-color-scheme: dark) { :root { … } }`
  *before* `:root.light`, so specificity (0,2,0 vs 0,1,0) is what makes the
  forced theme win. Worth knowing before adding a `:root` rule near those.
- The toggle shows the *preference*, not the resolved theme: on «system» the
  server cannot know what the visitor's OS is set to, and guessing would need a
  client round trip to say something the CSS already handles.
- `revalidatePath('/', 'layout')` re-renders the whole tree without disturbing
  client state — the explorer's selection and expanded folders survive a theme
  switch, so the control can live in the header of a page holding a push run.

**Verified in the browser** (http://localhost:3300, Playwright, both
`colorScheme: dark` and `colorScheme: light` contexts): with no cookie the
`<html>` class is empty, `color-scheme` reads `light dark` and the shell paints
black on a dark OS / white on a light one; «Claro» forces white on a dark OS and
«Oscuro» forces black on a light one, both repainting the whole UI including the
`dark:`-only header border; «Sistema» removes the class and the OS takes over
again. After a reload the class is already correct *at first commit* (no flash),
the cookie survives, the settings page shows the same active option, and a bogus
cookie value falls back to «system».

`pnpm typecheck` passes (no lint script in this project).

**Reusable patterns added to the top section:** the cookie/three-module shape for
a server-known preference, and `import 'server-only'` without the package.
---

## 2026-08-10 - US-021 Adopt the shared design tokens and accent colour

`globals.css` now carries the house token vocabulary — the same neutral ramp,
state scale and `light-dark()` mechanism as ~/dev/gym — with teal as this app's
brand colour, and every component reads it through `@theme inline` utilities.
All 460 raw palette utilities across the 14 `app/**/*.tsx` files are gone, and
with them every `dark:` variant: there is not one left in the markup.

**Files changed:**
- `app/globals.css` — bg, surface, surface-2, line, line-strong, content, muted,
  accent, accent-soft, accent-wash, on-accent, ok/warn/danger/info and their
  -wash variants, plus `--scrim`; each declared once with `light-dark()`. The
  `@theme inline` block exposes them as `bg-surface`, `text-muted`,
  `border-line`… Base styles moved onto the tokens (`body`, `::selection`, a
  single `:focus-visible` ring).
- `app/page.tsx`, `explorer.tsx`, `file-list.tsx`, `folder-tree.tsx`,
  `markdown.tsx`, `task-table.tsx`, `push-panel.tsx`, `transcript-preview.tsx`,
  `theme-toggle.tsx`, `settings/page.tsx`, `settings/context-folder-form.tsx`,
  `settings/linear-form.tsx`, `settings/provider-form.tsx` — utilities swapped
  for the semantic equivalents.

**Learnings:**
- The mapping that made the sweep mechanical: page canvas `bg-bg`, panels
  `bg-surface`, the two chrome strips (folder sidebar, push panel) and every
  inline `<code>`/hover `bg-surface-2`; body copy `text-content`, secondary
  `text-muted`; container borders `border-line`, form/button borders
  `border-line-strong`; every selection (tree row, file row, provider card,
  recents row, active theme segment) `border-accent bg-accent-wash`.
- **A `dark:` pair collapses into one token only when both sides mean the same
  thing.** They all did here except the modal veil: `bg-zinc-900/40
  dark:bg-black/60` is dark in *both* themes, and `--content` inverts, so
  reusing it would have painted a white veil in dark. That one needed its own
  `--scrim` token.
- **`--on-accent` cannot be `#ffffff`.** White on the dark-side teal `#2dd4bf`
  is 1.86:1. The dark side is near-black `#04231f` (8.91:1); light stays white
  (5.43:1 on `#0f766e`). The same token also works on `--danger` — white on
  `#b91c1c` is 6.47:1 and `#04231f` on `#f87171` is 6.00:1 — so the destructive
  button reuses it instead of needing an `--on-danger`.
- Opacity modifiers **do** work on a `light-dark()` token (`border-warn/30`,
  `border-danger/40`, `hover:border-danger/40`): Tailwind wraps it in
  `color-mix()`, which takes `light-dark()` as a colour. gym already relies on
  this; verified in the browser here.
- The `@custom-variant dark` block stays even with zero `dark:` utilities left:
  it costs nothing when unused and is the escape hatch for anything a colour
  token cannot express.
- `text-zinc-400 dark:text-zinc-600` (a *fourth* neutral, below muted — the «—»
  and «Pendiente» placeholders) has no token. `text-muted opacity-70` says the
  same thing without adding one.

**Verified in the browser** (http://localhost:3300, both themes, nothing pushed
to Linear): explorer and settings render correctly light and dark; the accent is
teal on the primary buttons with legible on-accent text on both sides; the
selected tree/file/provider rows show the accent wash; the folder error renders
`rgb(185, 28, 28)` (danger), the manual-changes counter and the Claude billing
warning render in warn; the regenerate dialog shows the scrim dark in both
themes with a readable destructive button. Computed styles confirmed the dark
side of every token resolves (`--surface-2` → `rgb(30, 33, 39)`, `--accent-wash`
→ `rgba(45, 212, 191, 0.1)`, `--content` → `rgb(230, 231, 233)`).

`pnpm typecheck` passes (no lint script in this project).

Note: `lib/linear.ts` carries an uncommitted change from an earlier iteration
(`statusFor` no longer folding 400 into 401); it was already in the tree and is
untouched by this story.
---
