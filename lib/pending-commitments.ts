/**
 * What is still open from *other* meetings of the project the user is pushing
 * to, as a selection over the push history.
 *
 * `lib/issue-state-summary.ts` answers what became of the issues of the note on
 * screen; this module answers the question the note on screen cannot ask about
 * itself — what did previous meetings of this same project promise that nobody
 * has closed yet. The rule lives here, and not in the panel that draws it, for
 * the reason every other piece of this arithmetic does: it is pure, and the
 * test suite only collects `lib/**`.
 *
 * The imports of `lib/store.ts` and `lib/linear.ts` are type-only on purpose:
 * both modules read the filesystem, `process.env` and the API key, and none of
 * it may reach the browser bundle this code runs in.
 */

import { groupOfStateType } from './issue-state-summary'
import type { IssueState } from './linear'
import type { HistoryEntry } from './store'

/** One issue of a previous meeting that is still waiting for somebody. */
export type PendingCommitment = {
  /** The issue as Linear reports it today — identifier, title, url and state. */
  issue: IssueState
  /** Root-relative path of the note that created it, so the panel can open it. */
  notePath: string
  /** The note's title, or its file name when nothing better is known. */
  noteTitle: string
  /** When the push that created it happened, so the panel can say how long ago. */
  pushedAt: string
}

export type PendingCommitmentsInput = {
  /** The whole push history, keyed by note path — `Config['history']`. */
  history: Readonly<Record<string, readonly HistoryEntry[]>>
  /**
   * What Linear says today, keyed by issue id — `issueStatesById()`. An issue
   * that is not in here is an issue nothing is known about: see below.
   */
  states: Readonly<Record<string, IssueState>>
  /** The note that is open, whose own issues are already shown next to it. */
  notePath: string
  /** The project the user is pushing to right now, or null when none is picked. */
  projectId: string | null
  /**
   * Titles the explorer already knows, keyed by note path. Optional: the panel
   * has the listing of the folder on screen, and a note from another folder
   * falls back to its file name rather than forcing a read from disk.
   */
  titles?: Readonly<Record<string, string>>
}

/**
 * The open commitments of previous meetings of the selected project, oldest
 * first.
 *
 * Four rules decide what is in, and each of them is about not nagging with
 * something that is not this meeting's business:
 *
 * - **A project has to be selected.** Without one there is no way to tell the
 *   pending work of this client from another's, and «todo lo abierto de todas
 *   las reuniones» is not what the panel promises. No project, no list.
 * - **Only pushes to that same project.** An entry written before the
 *   destination was recorded carries `projectId: null`, which is «no consta»
 *   and not «ninguno» (see `lib/store.ts`) — so it stays out. An old entry that
 *   happened to belong here is a smaller loss than a panel that mixes two
 *   clients' commitments.
 * - **Only what is still open.** Done and cancelled are both closed: nobody is
 *   waiting on either, the same reading `lib/pushed-progress.ts` uses.
 * - **Not the open note's own issues.** Those are already on screen, in their
 *   own block, with their own counters.
 *
 * An issue whose state is not in `states` is left out rather than shown without
 * one: either Linear no longer knows it — there is nothing to open, nothing to
 * chase — or the answer has not arrived yet, and it appears when it does. This
 * is the opposite call to `pushedProgress`, and for the same reason: there the
 * safe side was «queda trabajo», here it is «no reclames algo que no puedes
 * describir».
 *
 * The same issue reached twice — a note pushed twice carries it twice — is
 * listed once, under the *oldest* push that created it, which is how long it
 * has really been open. Pushes made at the same instant keep the order the
 * history is read in, and a `pushedAt` that is not a date sorts last: it is
 * unknown, and the top of this list reads as «lo más urgente».
 */
export function pendingCommitments({
  history,
  states,
  notePath,
  projectId,
  titles,
}: PendingCommitmentsInput): PendingCommitment[] {
  if (!projectId) return []

  const found: PendingCommitment[] = []

  for (const [path, entries] of Object.entries(history)) {
    if (path === notePath) continue
    const noteTitle = titles?.[path] ?? titleFromPath(path)

    for (const entry of entries) {
      if (entry.projectId !== projectId) continue

      for (const issue of entry.issues) {
        const state = states[issue.id]
        if (!state) continue
        const group = groupOfStateType(state.stateType)
        if (group === 'completed' || group === 'canceled') continue

        found.push({ issue: state, notePath: path, noteTitle, pushedAt: entry.pushedAt })
      }
    }
  }

  // `sort` is stable, so pushes made at the same instant keep the order the
  // history was read in. Sorting *before* dropping the repeats is what makes
  // «under the oldest push that created it» true: the first row an id reaches
  // here is then the earliest one, whatever order the history stores it in.
  found.sort((a, b) => time(a.pushedAt) - time(b.pushedAt))

  const seen = new Set<string>()
  return found.filter((commitment) => {
    if (seen.has(commitment.issue.id)) return false
    seen.add(commitment.issue.id)
    return true
  })
}

/**
 * What to call a note nobody handed a title for: its file name, undressed of
 * the extension and of the leading date the convention puts there —
 * `2026-08-09-cierre-con-acme.md` reads as `cierre con acme`.
 *
 * This mirrors `titleFromFileName` in `lib/transcripts.ts` rather than calling
 * it: that module reads the filesystem, and this one runs in the browser.
 */
function titleFromPath(path: string): string {
  const fileName = path.split('/').pop() ?? path
  const stem = fileName.replace(/\.md$/i, '')
  const withoutDate = stem.replace(/^\d{4}-\d{2}-\d{2}[ _-]*/, '')
  const cleaned = (withoutDate || stem).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || stem
}

/** A stamp that is not a date sorts last rather than as the oldest thing open. */
function time(pushedAt: string): number {
  const parsed = Date.parse(pushedAt)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}
