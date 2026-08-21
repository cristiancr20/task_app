/**
 * «Enviadas»: everything this note has already created in Linear, as one list.
 *
 * The same issues were being read twice in the same column — once in the push
 * history and once in the summary the send bar printed when a run finished —
 * and the two disagreed by design: the summary knew only about the run on
 * screen, the history only about what the server had written down. This module
 * is the one list both were approximations of, so the pestaña can hold the
 * whole answer to «¿qué produjo esta nota?» and the bar can go back to being
 * only a button.
 *
 * The run is folded into the record rather than shown beside it. The route
 * writes the history when the stream ends and the note re-reads it, so for a
 * moment — and for good, if that re-read fails — the only place the issues just
 * created exist is the browser's own run. Those are `fresh`: drawn first,
 * dated «hace un momento», and dropped the instant the same id arrives from
 * disk, which is what stops the panel counting one issue twice.
 *
 * The parent is marked here and not in the view because *which* issue stands
 * for the meeting is a fact about the run, not about the row: the record stores
 * it like any other issue, and only the run knows it was created as the parent.
 *
 * Nothing here reads the filesystem or imports React; the two `import type`s
 * are shapes.
 */

import type { PushedIssue } from './push-events'
import type { HistoryEntry } from './store'

/** One issue of the list, with what the panel needs beyond its link. */
export type SentIssue = PushedIssue & {
  /** The issue that stands for the meeting: the others hang from it. */
  parent: boolean
  /** Created by the run on screen and not yet written to the history. */
  fresh: boolean
}

/** One push, newest first. `pushedAt` is null for the run that just finished. */
export type SentPush = {
  pushedAt: string | null
  issues: SentIssue[]
}

/** The run on screen, as this module needs to see it — see `usePushRun`. */
export type SentRun = {
  parentIssue: PushedIssue | null
  issues: readonly PushedIssue[]
}

/** A run that created nothing, for a column with no push behind it. */
export const NO_SENT_RUN: SentRun = { parentIssue: null, issues: [] }

/**
 * Every push of this note, newest first, with the issues of each in the order
 * Linear created them — the parent first, since it is the one the rest hang
 * from and the one opened to see the meeting as a whole.
 *
 * Stored entries are oldest first and are reversed here: the last push is what
 * explains the current state of the file.
 */
export function sentPushes(history: readonly HistoryEntry[], run: SentRun): SentPush[] {
  const parentId = run.parentIssue?.id ?? null
  const recorded = new Set(history.flatMap((entry) => entry.issues.map((issue) => issue.id)))

  const stored: SentPush[] = history
    .map((entry) => ({
      pushedAt: entry.pushedAt,
      issues: entry.issues.map((issue) => sentIssue(issue, issue.id === parentId, false)),
    }))
    .reverse()

  const fresh = [...(run.parentIssue ? [run.parentIssue] : []), ...run.issues]
    .filter((issue) => !recorded.has(issue.id))
    .map((issue) => sentIssue(issue, issue.id === parentId, true))

  return fresh.length > 0 ? [{ pushedAt: null, issues: fresh }, ...stored] : stored
}

/**
 * Issues created from this note, which is the number the pestaña wears.
 *
 * It counts the list the panel draws and not the history behind it, so the tab
 * cannot say «12 enviadas» over thirteen links, and the number moves the moment
 * a run ends rather than when the note gets round to re-reading its history.
 */
export function sentIssueCount(pushes: readonly SentPush[]): number {
  return pushes.reduce((count, push) => count + push.issues.length, 0)
}

/**
 * The ids the state report is about — see `useIssueStates`. Freshly created
 * issues are in it, so a push that has just landed shows its states without
 * waiting for the history to be re-read.
 */
export function sentIssueIds(pushes: readonly SentPush[]): string[] {
  return pushes.flatMap((push) => push.issues.map((issue) => issue.id))
}

/** The stored issue carries more than the panel draws; only these travel. */
function sentIssue(issue: PushedIssue, parent: boolean, fresh: boolean): SentIssue {
  return {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
    title: issue.title,
    parent,
    fresh,
  }
}
