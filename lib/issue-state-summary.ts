/**
 * What became of the issues one note created, as arithmetic over the states
 * Linear reported.
 *
 * `lib/linear.ts` answers what each issue's state is; this module answers the
 * question the note's history actually asks — how many are done, how many are
 * moving, how many nobody has touched, and how many were dropped.
 *
 * It lives here rather than in `app/use-issue-states.ts` for the same reason
 * `lib/duplicate-check.ts` does: it is pure, and the test suite only collects
 * `lib/**`. The hook is left with the parts that are genuinely about React —
 * the fetch, the cache keyed by path and the late answer that must not land.
 *
 * The import of `lib/linear.ts` is type-only on purpose: that module reads
 * `process.env` and handles the API key, and none of it may reach the browser
 * bundle this code runs in.
 */

import type { IssueState, IssueStateType } from './linear'

/**
 * The four buckets the note's summary is read in.
 *
 * Linear has six state *types* and a workspace renames its states freely, so
 * the grouping is by type and never by name. `triage` and `backlog` collapse
 * into `unstarted` because from the meeting's point of view they are the same
 * news — nobody has started this yet — and three flavours of «not started»
 * would be a taxonomy of Linear rather than an answer about the meeting.
 */
export type IssueStateGroup = 'completed' | 'started' | 'unstarted' | 'canceled'

/**
 * The order the groups are read in: what is finished, what is moving, what is
 * not, and what was dropped. Exported so the counters and any legend cannot
 * drift apart.
 */
export const ISSUE_STATE_GROUPS: readonly IssueStateGroup[] = [
  'completed',
  'started',
  'unstarted',
  'canceled',
]

/** How many issues of the note sit in each group. */
export type IssueStateSummary = {
  completed: number
  started: number
  unstarted: number
  canceled: number
  /** Issues Linear answered for — the sum of the four counters. */
  total: number
}

/** Which bucket a Linear state type is read in. */
export function groupOfStateType(type: IssueStateType): IssueStateGroup {
  switch (type) {
    case 'completed':
      return 'completed'
    case 'started':
      return 'started'
    case 'canceled':
      return 'canceled'
    // `triage` and `backlog` are «nobody has started this», same as `unstarted`.
    default:
      return 'unstarted'
  }
}

/**
 * The note's issues counted by group.
 *
 * Only what Linear answered for is counted: an issue the workspace no longer
 * knows about simply does not come back from `fetchIssueStates`, and inventing
 * a bucket for it would report on something nobody can open. `total` is
 * therefore the size of the report, not the size of the history — the history
 * is already counted, in its own line above.
 *
 * A repeated id is counted once. The route asks Linear for a deduplicated list
 * so this cannot normally happen, but a note pushed twice does carry the same
 * issue twice in its history, and a counter that disagreed with the list below
 * it would be worse than one that is merely defensive.
 */
export function summarizeIssueStates(states: readonly IssueState[]): IssueStateSummary {
  const summary: IssueStateSummary = {
    completed: 0,
    started: 0,
    unstarted: 0,
    canceled: 0,
    total: 0,
  }
  const counted = new Set<string>()

  for (const state of states) {
    if (counted.has(state.id)) continue
    counted.add(state.id)
    summary[groupOfStateType(state.stateType)] += 1
    summary.total += 1
  }

  return summary
}

/**
 * The reported states by issue id, so the history list can find its own rows
 * without scanning the report once per line. An id that was reported twice
 * keeps its first answer, which is the one `summarizeIssueStates` counted.
 */
export function issueStatesById(states: readonly IssueState[]): Record<string, IssueState> {
  const byId: Record<string, IssueState> = {}
  for (const state of states) {
    if (!(state.id in byId)) byId[state.id] = state
  }
  return byId
}
