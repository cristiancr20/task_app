# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

### An effect that acts on the rows it was computed from needs a memory

«Uncheck this row once, and let the user put it back» is not the checkbox: the
condition that triggered the exclusion (the row is an open duplicate) is still
true after it, so an effect keyed on the condition alone unchecks the row again
every time the user checks it. What makes it settle is a second piece of state
recording *that the app has already decided* — `autoExcluded` in
`app/explorer.tsx`, a `Set` of `exclusionKey(scopeKey, rowId)`.

Three things follow, and all three are load-bearing:

- The key is scoped, not just the row id. The same task duplicates something in
  one project and nothing in the next, so the row gets one automatic verdict per
  destination rather than one per session.
- The verdict is spent on rows that are *already* in the target state too, not
  only on the ones being changed now. The change is persisted (the row's
  `include` goes to `.data/drafts.json`) while the memory only lives as long as
  the page, so a reload otherwise finds the row changed, cannot tell who changed
  it, and changes it again.
- The decision is a pure function of (rows, answers, scope, memory) returning
  *both* the work to do and how to describe what was already done —
  `decideDuplicates` → `{ toExclude, forced, excluded }`. That is what makes it
  testable with no DOM: call it, apply what the effect would apply, call it
  again, and assert the second call has nothing left to do.

The effect itself must depend on the destructured callback
(`const { excludeRows } = drafts`), never on the hook's return value — those
hooks return a fresh object every render.

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

### A hook that fetches per destination and answers per note

`app/use-duplicate-check.ts` is the shape to copy when a hook caches two things
with different lifetimes: the remote data belongs to the *destination* (one
`Record` keyed by a string built from the ids — a fresh `{teamId, projectId}`
object per render says nothing, so the key is the identity) and the results
belong to the *note* (a second `Record` keyed by path, like the drafts and the
push run). Three details are what make it behave:

- Every asynchronous write goes under the key it was asked for *and* is dropped
  when a newer round has replaced it (`previous[key]?.key !== next.key`), which
  is what keeps a slow answer off another note and off another project.
- A debounced effect must not depend on the arrays it reads. `rows` is a new
  literal on most renders, so the effect deps hold a **signature string**
  (`id:title` joined) and the callback reads the current rows from a ref
  updated by an effect declared *above* it — effects of one commit run in
  declaration order, so the ref is fresh when the timer is scheduled.
- «Do it again» needs its own counter. A re-check button that only re-ran the
  effects would find every row already scored and every destination already
  fetched; the `attempt` number rides in both keys, so bumping it invalidates
  the request and the results at once.

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

## 2026-08-19 - US-006

The duplicate check itself: the destination's issues read once, every row of
the table scored against them, and nothing blocked by the answer.

- `lib/duplicate-check.ts` (new, pure): `DuplicateScope` with
  `scopeKeyOf`/`scopeFromKey` (the destination as one comparable string);
  `matchIssue` → `DuplicateMatch` (`score`, `identifier`, `title`, `url`,
  `closed`, `duplicate`) with `MIN_REPORTED_SCORE`; `checkRows`, which keeps
  the previous `RowCheck` of a row whose title has not changed and forgets the
  rows it is not given; `pendingRowIds`, `needsCheck`, `matchesOf` and
  `isOpenDuplicate`.
- `app/use-duplicate-check.ts` (new): the destination's issues cached by scope
  key and reused across notes, the results keyed by transcript path, a 400 ms
  debounce over the scoring, an `attempt` counter behind «Buscar duplicados»,
  and `status`/`error` that are never a reason not to push.
- `app/push-panel.tsx`: the «Buscar duplicados» button and its notice — inline,
  `aria-live`, `text-warn` for a failed check, `text-muted` otherwise.
- `app/explorer.tsx`: the scope (only with a project chosen), the set of rows
  already created in this push, and the hook wired to both.
- `lib/duplicate-check.test.ts` (new): 36 cases over the scope key and its
  round trip, the match and its fields, the threshold and the floor, the reuse
  and invalidation in `checkRows`, `needsCheck` across destination and round,
  and what `matchesOf` refuses to show.

**Learnings:**

- `similarity` never returns 0 between two real Spanish titles: «Migrar el
  endpoint de pagos» against «Contratar el seguro de la oficina» is 0.093, from
  shared bigrams alone. So «the closest issue» and «is there a match» are two
  questions, and `matchIssue` needs a floor (`MIN_REPORTED_SCORE = 0.3`, the
  measured ceiling of unrelated pairs from US-005) or every row would carry a
  9% match nobody would make. Four tests failed on exactly this assumption
  before the floor existed.
- Storing the title *inside* each `RowCheck` is what makes an edit invalidate
  its own result with no extra bookkeeping: `matchesOf` drops any check whose
  title no longer matches the row, so the badge disappears on the first
  keystroke and comes back when the debounce lands. The same comparison is what
  `checkRows` reuses to re-score one row instead of the table.
- Only a chosen project is a scope worth checking. The client supports a
  team-wide listing, but a check against the whole team reports tasks from
  other projects as duplicates — so the explorer passes `null` until there is a
  project, and the hook reads that as «not conclusive».
- A closed match is deliberately not a duplicate for the purposes of blocking:
  `isOpenDuplicate` is `duplicate && !closed`, because a task that was done
  once and is asked for again is ordinary. The `closed` flag still travels so
  the row can say which of the two it is.
- The React part could not be covered by the suite (`lib/**/*.test.ts`, node
  environment, no DOM), so everything that could be made pure was moved out of
  the hook — the hook is left with the fetch, the debounce and the two caches,
  and `pnpm build` is what checks that none of `lib/linear.ts` reached the
  client bundle through it.

---

## 2026-08-19 - US-007

The check's answer, on screen: a badge per row, the row taken out of the push
once, and the panel's count adding up again.

- `lib/duplicate-check.ts`: `matchGrade`/`MATCH_GRADE_LABELS` (four bands over
  the measured populations, so the decimal never reaches the table);
  `IncludableRow`; `exclusionKey` (the verdict, per destination and per row);
  `decideDuplicates` → `{ toExclude, forced, excluded }`, the whole of what the
  duplicates mean for the push.
- `app/task-table.tsx`: `DuplicateBadge` under the title — a `chip` linking to
  the issue (`target="_blank"`), the identifier in mono, the grade in words,
  the issue's own title truncated beside it, and «Se enviará igualmente» when
  the row was checked back. Warn for an open duplicate, muted for a closed one
  and for a near match. A «Comprobando duplicados…» chip in the header, and
  `showDuplicates` gating all of it.
- `app/push-panel.tsx`: `duplicates.excluded` and a second chip,
  «N duplicadas excluidas», next to the count the button is about to create.
- `app/explorer.tsx`: the `autoExcluded` memory, `decideDuplicates` in a
  `useMemo`, and the effect that unchecks `toExclude` and records it.
- `app/use-task-drafts.ts`: `excludeRows(ids)` — one patch for the whole list,
  returning the previous state untouched when every row was already unchecked.
- `lib/duplicate-check.test.ts`: 18 more cases over the bands (re-measuring the
  reformulation pairs rather than asserting numbers copied from a comment), the
  key, and every branch of `decideDuplicates` including the settle-in-one-pass
  and reload paths.

**Learnings:**

- The bands were measured, not chosen (`npx tsx` at the repo root over
  `similarity`, then deleted): identical-after-normalisation pairs are 1.000 on
  the nose, reformulations 0.684–0.738, different-tasks-same-subject
  0.420–0.569, unrelated 0.093–0.122. So 0.9 separates «the same words» from
  the best reformulation and 0.65 sits in the gap under the worst one — and the
  fourth band is «baja» rather than a fourth shade of yes, because below
  `DUPLICATE_THRESHOLD` nothing is called a duplicate at all.
- «Una sola vez» is a memory, and it has to be keyed by destination as well as
  by row: the same task duplicates something in one project and nothing in the
  next, so a row deserves one automatic verdict per destination rather than one
  per session.
- The verdict has to be spent on rows that are *already* unchecked, not only on
  the ones being unchecked now. The exclusion is persisted with the row in
  `.data/drafts.json` while the memory only lives as long as the page, so
  without that the reload after a push finds the row unchecked, cannot tell who
  unchecked it, and unchecks it a second time the moment the user asks for it
  back. `excludeRows` is then a no-op on the rows and returns `prev` itself, so
  neither a render nor a save comes of it.
- A React effect that changes the rows it was computed from settles only if the
  change removes its own trigger: unchecking alone does not (the row is still
  an open duplicate), the memory is what does. The pair is testable without a
  DOM — `decideDuplicates` twice, applying in between what the effect applies —
  which is the «settles in one pass» case.
- `useTaskDrafts` returns a fresh object every render, so an effect that calls
  one of its functions must depend on the destructured function (stable through
  `useCallback`), not on the hook's return value. Depending on `drafts` re-runs
  the effect on every render of the page.
- Nothing about the check reaches the push: `pushBlockedBy` never mentions it,
  and the only thing the check does to the button is lower `pending` by
  unchecking rows — which is exactly why the panel needs the second chip, or
  the button and the table would disagree with nothing on screen to explain it.

---
