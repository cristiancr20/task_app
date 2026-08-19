# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

### Adding a field to `ExtractedTask` touches five literals

`ExtractedTask` (lib/extractors/task.ts) is spread into `DraftRow`
(lib/drafts-store.ts) and `TaskDraft` (app/use-task-drafts.ts), so a new
required field breaks typecheck in every place a row is built as an object
literal rather than copied. The full list:

- `normalizeTask` in lib/extractors/task.ts (the model's answer)
- `normalizeRow` in lib/drafts-store.ts (what comes back off disk)
- `blankDraft` in app/use-task-drafts.ts (a row added by hand)
- the `row()` fixtures in lib/drafts-store.test.ts, lib/drafts-merge.test.ts,
  lib/drafts-client.test.ts (typed `Partial<DraftRow>`, so they fail to compile)
- any test asserting with `toEqual` on a whole row — those fail at runtime, not
  at typecheck, so run `pnpm test` as well as `pnpm typecheck`.

`lib/extractors/{ollama,claude}.ts` need nothing: both hand the model the same
`TASKS_JSON_SCHEMA` and pipe the answer through `normalizeTasks`.

### A story asking for tests of `app/` code means moving it to `lib/`

`vitest.config.mts` collects `lib/**/*.test.ts` and nothing else, and AGENTS.md
asks for pure functions rather than React components. So when logic in `app/`
needs coverage, extract the pure part into `lib/` (typed against `DraftRow`
from `lib/drafts-store`, which `TaskDraft` structurally is) and re-export it
from the original module so existing imports keep resolving — that is how
`countManualChanges` ended up in `lib/drafts-changes.ts`.

### There is no `pnpm lint`

package.json has only `dev`, `build`, `start`, `typecheck`, `test`,
`test:watch`; `pnpm lint` falls through to an unrelated global binary. There is
no eslint or prettier config either — match the surrounding style by hand
(~100 columns, single quotes, no semicolons).

---


## 2026-08-19 - US-001

Added `dueDate` to the extraction contract, end to end within the extractor.

- `lib/extractors/task.ts`: `dueDate: ['string', 'null']` in
  `TASKS_JSON_SCHEMA` (required, inside the subset Ollama and Anthropic share),
  two `SYSTEM_PROMPT` rules about resolving relative deadlines against the
  meeting date and answering null instead of inventing one, a `Meeting date:`
  header line in `buildUserPrompt` that names the anchor explicitly (and says
  deadlines cannot be resolved when the note has no date), `dueDate: string |
  null` on `ExtractedTask`, and `normalizeDueDate` in the normaliser.
- `lib/extractors/task.test.ts`: a `normalizeTasks: dueDate` block (valid date,
  leap day, relative phrases, other formats, impossible dates, ISO timestamp,
  missing field, non-strings) plus the reworded `buildUserPrompt` assertions.
- `lib/drafts-store.ts`, `app/use-task-drafts.ts` and three test fixtures: the
  minimum for typecheck to pass with a new required field. The editable column
  and the table wiring stay with US-002.

**Learnings:**

- The prompt header line changed from `Date:` to `Meeting date: … — resolve
  every relative deadline against this date.`, so two existing
  `buildUserPrompt` tests had to be reworded. The no-date case now emits a line
  instead of omitting one — the model needs to be told the anchor is missing,
  otherwise it resolves "el viernes" against its own idea of today.
- `normalizeDueDate` validates the day against a hand-written month table
  rather than round-tripping through `Date`: `Date.UTC` maps years 0–99 to
  1900–1999, so a four-digit year like `0099` would validate against the wrong
  year. Leap years are checked with the plain 4/100/400 rule.
- A trailing time part is dropped (`2026-08-19T00:00:00Z` → `2026-08-19`) but
  the date part is still validated, so `2026-02-31T00:00:00Z` is null.
- `text()` in task.ts stringifies numbers and booleans; `normalizeDueDate`
  deliberately does not use it — a number can never be a `YYYY-MM-DD` date, and
  stringifying it would only make the regex do the rejecting.

---

## 2026-08-19 - US-002

The «Vence» column, editable, plus the change count that has to notice it.

- `app/task-table.tsx`: an `input type="date"` in the row's chip line, labelled
  «Vence», styled with `FIELD`, `disabled={busy}` like every other editable
  field, and `event.target.value || null` on change so an emptied field stores
  null rather than `''`.
- `lib/drafts-changes.ts` (new): `countManualChanges`, `ManualChanges`,
  `NO_CHANGES` and `sameDraft`, moved out of `app/use-task-drafts.ts` verbatim
  except for the new `a.dueDate === b.dueDate` comparison. It works on
  `DraftRow`, which `TaskDraft` structurally is.
- `app/use-task-drafts.ts`: imports the count and re-exports it
  (`export { countManualChanges, type ManualChanges } from '@/lib/drafts-changes'`),
  so `task-table.tsx`'s import of it from `./use-task-drafts` still resolves.
- `lib/drafts-changes.test.ts` (new): the pre-existing behaviour (untouched
  table, edited title, added/removed rows, unchecked «incluir») plus a
  `dueDate` block — corrected date, date typed onto a row that had none,
  cleared date, same date on both sides, and date-plus-priority counted once.
- Persistence needed nothing: `normalizeRow` in `lib/drafts-store.ts` already
  restores `dueDate` (US-001) and `durableOf` stores whole rows.

**Learnings:**

- `vitest.config.mts` only collects `lib/**/*.test.ts`, so a story that asks
  for tests of something in `app/` means moving the pure part into `lib/`
  rather than widening the glob — which is also what AGENTS.md asks for
  ("cover pure functions and server-side logic, not React components").
  `countManualChanges` was already free of React; only its parameter type had
  to loosen from `TaskDraftState` to `{ rows, baseline }` (`ChangeableDrafts`).
- The table has no `<table>`: it is a list of cards, so a "column" is a
  labelled field in the row's `flex-wrap` chip line next to the priority
  select. A visible `<label>` is needed there — an empty `input type=date`
  shows `dd/mm/aaaa`, which names the format but not the field.
- `event.target.value` of a date input is `''` when the user clears it, never
  null, so the `|| null` at the call site is what keeps `''` out of the state —
  and out of `sameDraft`, where `'' !== null` would count a cleared-then-
  restored field as a permanent edit.

---
