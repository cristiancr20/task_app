/**
 * How far along the tasks of an already-pushed note are, in the two numbers a
 * row of the file list has room for.
 *
 * `lib/issue-state-summary.ts` answers the same question for the note that is
 * open, in four counters; this one answers it for a note nobody has opened, in
 * the one distinction the list is scanned for — is this meeting finished, or is
 * something still coming back? It lives here rather than in `app/file-list.tsx`
 * for the reason every other piece of this arithmetic does: the suite only
 * collects `lib/**`.
 *
 * The import of `lib/linear.ts` is type-only: that module reads `process.env`
 * and handles the API key, and none of it may reach the browser bundle.
 */

import { groupOfStateType } from './issue-state-summary'
import type { IssueState } from './linear'

/** What the badge of one already-pushed note says beyond «ya se envió». */
export type PushedProgress = {
  /** Its issues Linear reports as closed. Never more than `total`. */
  closed: number
  /** Issues the note created, from its own history. */
  total: number
  /** Nothing is pending: every task the note created is closed. */
  done: boolean
}

/**
 * The progress of a note, or `null` when there is nothing to say yet.
 *
 * `null` is «lo de hoy»: no key, no answer from Linear yet, or a note whose
 * issues the workspace no longer knows — the badge then reads exactly as it did
 * before this existed, which is also why the badge never has to blink between a
 * placeholder and a number.
 *
 * The denominator is the note's own history and not the size of the report. It
 * is the number the row was already showing, so an answer that arrives late
 * completes the badge instead of rewriting it; and an issue Linear has forgotten
 * about is then counted as not closed, which errs towards «queda trabajo» —
 * saying a meeting is finished because an issue was deleted would be the one
 * mistake worth avoiding here.
 *
 * A closed task is one nobody is waiting on: done, or cancelled on purpose. The
 * four-way breakdown is a click away, inside the note.
 */
export function pushedProgress(
  issues: number,
  states: readonly IssueState[] | undefined,
): PushedProgress | null {
  if (issues <= 0 || !states || states.length === 0) return null

  // A note pushed twice carries the same issue twice in its history, and Linear
  // answers for it once — counting it twice would close a note that is not.
  const counted = new Set<string>()
  let closed = 0

  for (const state of states) {
    if (counted.has(state.id)) continue
    counted.add(state.id)
    const group = groupOfStateType(state.stateType)
    if (group === 'completed' || group === 'canceled') closed += 1
  }

  closed = Math.min(closed, issues)

  return { closed, total: issues, done: closed === issues }
}
