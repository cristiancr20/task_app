# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

### Calibrating a number against real examples: `npx tsx` from the repo root

A threshold, a weight or a cutoff should be measured before it is written down,
and vitest is the wrong tool for it — the numbers are wanted on screen, not
asserted. `npx tsx probe.mts` runs a throwaway script against the modules
directly, but it must sit at the **repo root**: from `/tmp` the relative import
resolves against `/tmp/lib`, and the `@/` alias is a vitest/tsconfig mapping
that tsx does not read either, so the probe imports `./lib/<module>`. Delete it
before finishing — an uncommitted `probe.mts` at the root is not a test file
and nothing collects it. Whatever the probe printed belongs in the comment next
to the constant; that is the only record of why the number is what it is.

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

### Verifying a route against a stub Linear without touching `.data/`

`LINEAR_API_URL` is read at module load, so a throwaway `lib/zz-*.test.ts`
(deleted before finishing) must set `process.env.LINEAR_API_URL` to a
`http.createServer` listening on port 0 *before* `await import('@/lib/linear')`
— a static import would freeze the real endpoint. The route itself is
importable the same way (`@/app/api/linear/push/route`) once `@/lib/store` and
`@/lib/transcripts` are `vi.mock`ed, which is what keeps the check off the real
`.data/config.json` and off the configured context root. `POST()` returns a
normal `Response`, so `await response.text()` gives the whole NDJSON stream to
assert on.

### A `GET /api/linear/*` route is three files, always the same three

Every Linear read follows the shape `/api/linear/{verify,projects,issues}` already
share, and a new one that skips a layer breaks the convention the UI relies on:

- `lib/linear.ts` — the query and the parsing, throwing `LinearApiError`. It
  never reads the store, so the tests can drive it with a stubbed `fetch`.
- `app/api/linear/<name>/route.ts` — reads the key with `getConfig()`
  server-side (never from the URL), validates its own parameters with
  `HttpError(400, …)` in Spanish, and wraps everything in
  `try/catch → errorResponse(err, '')`, which already maps `LinearApiError` and
  `LinearUnreachableError` to a status and a message.
- `lib/<name>-client.ts` — a browser wrapper that type-only-imports its types
  from `lib/linear.ts` (that module reads `process.env`, so nothing else of it
  may reach the client bundle), rethrows `body.error` verbatim, and re-checks
  the shape with a local guard before handing the data to the UI.

An optional id must be left out of the query string entirely rather than sent
empty: `projectId=` reaches the route as a project called `''`, which is not the
same as «no project».

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

## 2026-08-19 - US-003

The due date now travels from the table to the Linear issue.

- `lib/linear.ts`: `dueDate?: string | null` on `CreateIssueInput`, trimmed in
  `createIssue` and spread into the `IssueCreateInput` only when it carries a
  value — the same conditional omission `projectId` and `parentId` use.
- `lib/push-events.ts`: `dueDate: string | null` on `PushTaskInput` (required,
  so every place that builds the wire payload fails typecheck until it sends it).
- `app/api/linear/push/route.ts`: `readTask` runs the date through
  `normalizeDueDate`, so a row the user typed by hand with an unusable date
  loses only its deadline instead of sinking the whole push.
- `lib/extractors/task.ts`: `normalizeDueDate` is now exported (it was already
  written and tested; only the keyword and its doc comment changed).
- `lib/linear-push.ts`: passes `dueDate: task.dueDate` on every task. The parent
  keeps its three-field call — it stands for the meeting, not for a commitment.
- `app/explorer.tsx`: `dueDate: row.dueDate` in the tasks it POSTs.
- `lib/linear.test.ts`: `sends dueDate when the task carries one` (asserting the
  trim) plus an `it.each` over null/undefined/empty/blank asserting the key is
  absent from the mutation input.

**Learnings:**

- `IssueCreateInput.dueDate` is a `TimelessDate`, so `''` is not a value it
  takes — and `''` is exactly what an emptied date input produces upstream. The
  field arrives as `string | null` from the table, so conditional omission
  (`dueDate ? { dueDate } : {}`, the `projectId`/`parentId` spelling) is what
  makes null, undefined and `''` all mean «no deadline» without a flat key ever
  reaching the API. Not verified against the real API — the stub accepts
  anything — but omission is the case the mutation is known to handle.
- Making `PushTaskInput.dueDate` required rather than optional is what made
  `app/explorer.tsx` fail typecheck — that literal is the only place that builds
  the request body, and an optional field would have shipped a silently
  date-less push that every test still passed.
- The route reuses `normalizeDueDate` instead of a second validator: a row added
  by hand never went through the extractor, so without it the browser is the
  only thing standing between a typo and the mutation. Exporting it also keeps
  the leap-year and impossible-date rules (and their tests) in one place.
- Verified against a local GraphQL stub through `LINEAR_API_URL`: a push with a
  parent sent `{title: 'Weekly sync', projectId: 'p1'}` with no `dueDate` key at
  all, the dated task sent `dueDate: '2026-08-28'`, and the undated one omitted
  it. Through the real route, `'el viernes'` and `'2026-02-31'` were dropped to
  no key while `'2026-09-01T10:00:00Z'` arrived as `'2026-09-01'`, and the
  stream still ended `{"type":"done","created":4,"failed":0}`.

---

## 2026-08-19 - US-004

Reading back what already exists in the push destination, so a later story can
compare it against the tasks about to be created.

- `lib/linear.ts`: `ExistingIssue` (`id`, `identifier`, `title`, `url`,
  `stateName`, `closed`), `DuplicateCheckScope` (`teamId` + optional
  `projectId`), `PROJECT_ISSUES_QUERY`/`TEAM_ISSUES_QUERY` at
  `ISSUE_PAGE_SIZE = 50` with the choice commented like the queries above, and
  `listIssuesForDuplicateCheck` — the `listTeamsAndProjects` loop verbatim
  (`MAX_PAGES`, break when the cursor stops advancing) reading through the
  existing `readConnection`. `readExistingIssue` drops a node with no id or no
  title and fills in the rest, like `readTeam`/`readProject`.
- `app/api/linear/issues/route.ts`: `GET ?teamId=&projectId=`, answering
  `{ issues }`; 400 when `teamId` is missing, key from `getConfig()`,
  `errorResponse` for everything else.
- `lib/linear-client.ts`: `fetchLinearIssues(scope)` with its own `isIssues`
  guard, following `fetchLinearTeams`.
- `lib/linear.test.ts`: a `listIssuesForDuplicateCheck` block — two-page
  pagination asserting the variables of each call, the team fallback for
  undefined/empty/blank `projectId`, the state-type mapping, partial and
  malformed nodes, the `MAX_PAGES` backstop and a cursor-less last page, and the
  translation of a 400/401 out of Linear.
- `lib/linear-client.test.ts` (new): URL building, `body.error` passthrough, the
  fallback message, an unexpected shape and a network failure.

**Learnings:**

- `closed` is derived from `state.type` (`completed`/`canceled`), never from
  `state.name`: a workspace renames its states freely, so «Done» proves nothing.
  The name still travels because it is what the UI would show.
- Both issue queries hold a *single* connection with a flat node (only `state`
  is nested, and it is an object, not a connection), so the complexity trap that
  forced `TEAMS_QUERY` down to 25x50 does not apply — the pagination stays at 50
  anyway, for 1000 issues per destination with `MAX_PAGES`.
- One loop covers both scopes by picking the query, the variables *and* the
  `data` field to read (`project` vs `team`) up front — `readConnection(body[parent],
  'issues')` is then the same call for either. Duplicating the loop per scope was
  the alternative and would have duplicated the pagination too.
- Verified against a local GraphQL stub through `LINEAR_API_URL` with
  `@/lib/store` mocked (the throwaway-test pattern above): the route followed
  the cursor across two pages, sent the key in `Authorization`, dropped the
  id-less node, answered the two issues with `closed: true/false`, answered
  `{"error":"Falta el parámetro «teamId» con el equipo de Linear."}` with a 400,
  and switched to `query TeamIssues(` with `{ teamId: 't1' }` when `projectId`
  arrived blank.

---

## 2026-08-19 - US-005

The duplicate check's arithmetic: a pure module that scores how alike two task
titles are, with no model call and nothing imported at all.

- `lib/similarity.ts` (new, zero imports): `normalizeForMatch` (NFD +
  `\u0300-\u036f` stripping, lowercase, non-alphanumerics to spaces, then stop
  words in Spanish *and* English plus the filler verbs `hacer`/`revisar`/`do`/
  `check` — undone whenever the filtering would empty the title);
  `similarity(a, b)` as 0.6 x token Dice + 0.4 x character-bigram Dice over
  multisets; `bestMatch(candidate, existing, text?)` returning `{item, score}`
  or null; `DUPLICATE_THRESHOLD = 0.55` with the measurements it was picked
  from in its comment.
- `lib/similarity.test.ts` (new): normalisation (accents, ñ, digits, both stop
  word lists, the all-filler fallback), 1 for identical and for case/accent/
  punctuation-only differences, five reformulations above the threshold, four
  clearly-different pairs below it, 0 for the empty string on either side, two
  long unrelated Spanish texts under 0.3, a short title against the paragraph
  containing it, symmetry and the 0..1 range, and `bestMatch`'s null, accessor,
  tie and empty-candidate cases.

**Learnings:**

- The measured gap is much narrower than «duplicate vs not» suggests, and only
  one case sets its width: two *different* tasks about the *same* subject.
  «Migrar endpoint de pagos a la nueva API» vs «Documentar el endpoint de pagos
  en la wiki» scores 0.497 — while unrelated tasks sit under 0.30 and real
  reformulations start at 0.58. So the threshold is bounded below by 0.50, not
  by the unrelated pairs, and anything at or under 0.5 would flag half a
  project's backlog against itself.
- Either measure alone is wrong in a way the other is not, which is why the
  criteria ask for both: exact token overlap scores «migrar»/«migración» as a
  miss (0.667 on that pair, from the two words they do share), and character
  bigrams alone give two long unrelated Spanish sentences ~0.4 for free, from
  `de`, `os`, `ci` and the rest. Weighted 0.6/0.4 the reformulation holds at
  0.735 and the long pair drops to 0.118.
- Dice is taken over *multisets*, not sets: a repeated bigram (`en` in
  «endpoint») counted once would make a long text look more like everything.
  And the length penalty in Dice's denominator is what keeps «Enviar
  presupuesto» at 0.473 against the paragraph that literally contains it.
- One-word titles are the weak spot and the module cannot fix it: «Pagos» vs
  «Pago» scores 0.343, since the token half is a flat 0 and only the bigrams
  speak. Nothing in the acceptance criteria depends on it, but a caller should
  not expect single words to be caught.
- The stop word filtering has to be undoable per title, not conditional per
  word: «Revisar» is a whole title in a note, and a normaliser that returned
  `''` for it would score it 0 against every issue — silently, since 0 is also
  what a genuinely empty string gets.

---
