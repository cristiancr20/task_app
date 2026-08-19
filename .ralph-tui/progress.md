# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

### Linear GraphQL client (`lib/linear.ts`)

- Every list-shaped call follows the same shape: build the query with the page
  size interpolated, loop `for (let page = 0; page < MAX_PAGES; page++)`, read
  the connection with `readConnection(parent, key)`, map nodes through a
  `readX()` that returns `null` for a partial node, and `break` when
  `!hasNextPage || !endCursor`. `readConnection` already folds a missing cursor
  into `hasNextPage: false`, so the loop cannot spin on a stuck cursor.
- The first page must not send `after` at all — spread it conditionally
  (`...(after ? { after } : {})`); `after: null` asks Linear for a page before
  the first.
- Page sizes carry a comment justifying the number against Linear's
  multiplicative query-complexity budget; nested `pageInfo` is what blows it.
  Do not raise one without re-testing the exact query.
- Tests stub `fetch` with `stubFetch(reply)` in `lib/linear.test.ts`; `reply` is
  a function of the call, so it can answer forever (that is how the
  never-advancing cursor and per-batch responses are exercised). `MAX_PAGES` and
  the batch size are not exported, so tests mirror them as local constants.

---

## 2026-08-19 - US-001
- `fetchIssueStates(apiKey, ids)` in `lib/linear.ts`: asks Linear for the current
  state of issues by id, filtered server-side (`filter: { id: { in: $ids } }`),
  in batches of `ISSUE_ID_BATCH_SIZE` (= `ISSUE_PAGE_SIZE`, 50), each batch
  paginated with the existing `MAX_PAGES` pattern. Returns `IssueState`
  (`id`, `identifier`, `title`, `url`, `stateName`, `stateType`), with
  `IssueStateType` as our own union and any unknown value read as `unstarted`.
- Ids are trimmed and deduplicated; an empty (or all-blank) list returns `[]`
  without a request. Ids Linear no longer knows simply do not come back.
- Files changed: `lib/linear.ts`, `lib/linear.test.ts` (new `fetchIssueStates`
  describe block: single batch, several batches, pagination, stuck cursor,
  missing id, every state type, unknown/missing/non-string type, partial nodes,
  502/401 translation, no-network-on-empty).
- `pnpm typecheck` and `pnpm test` pass (466 tests).
- **Learnings:**
  - `readConnection(body, 'issues')` works straight off the `data` payload for a
    root-level connection — the duplicate-check queries only nest it because
    they scope by `project`/`team`.
  - The unknown-state fallback is a `find` over a `readonly IssueStateType[]`
    rather than a `Set`/`includes`, which keeps the narrowing to the union
    without a cast.
  - Deduplicating the ids matters because the same issue can appear twice in a
    note's history, and its copies could land in different batches — Linear
    would then return it once per batch.
---
