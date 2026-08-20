'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchIssueStates } from '@/lib/issue-states-client'
import {
  type IssueStateSummary,
  issueStatesById,
  summarizeIssueStates,
} from '@/lib/issue-state-summary'
import type { IssueState } from '@/lib/linear'

/**
 * Where the report stands. `unavailable` is not a failure: nothing was ever
 * asked, because there is no key to ask with or the note never produced
 * anything — and the history is shown exactly as it was before this existed.
 */
export type IssueStatesStatus = 'unavailable' | 'loading' | 'ready' | 'error'

export type IssueStatesApi = {
  status: IssueStatesStatus
  /**
   * What Linear says about each issue, by id. Empty until the answer lands,
   * and missing an issue the workspace no longer knows about.
   */
  byId: Record<string, IssueState>
  /** The counters, or null while there is nothing to count them from. */
  summary: IssueStateSummary | null
  /** Why the report could not be read, in Spanish, or null. */
  error: string | null
  /** «Reintentar»: ask again for the note on screen. */
  retry: () => void
}

/** One note's report, as one request's worth of state. */
type Report = {
  /** The round that asked for it, so a superseded answer is not written. */
  key: string
  status: 'loading' | 'ready' | 'error'
  states: IssueState[]
  error: string | null
}

const NO_STATES: IssueState[] = []
const NO_BY_ID: Record<string, IssueState> = {}

/**
 * What became of the issues the selected note created.
 *
 * Keyed by path like the drafts, the push run and the duplicate check: the
 * explorer does not unmount this panel when the selection changes, so the
 * report of one meeting must never be read as another's. That is also what
 * makes the cache a cache — browsing away and back shows the answer again
 * without a second round trip, for as long as the page is open.
 *
 * The round key carries the note's issue ids as well as the round number, so a
 * push that adds issues to the history invalidates the report by itself: the
 * ids it was computed from are no longer the ids of the note. Nothing else
 * expires it — a state that changes in Linear while the page is open is what
 * «Reintentar» is for.
 *
 * Every answer is written under the key it was asked for and dropped when that
 * key is no longer the note's, which is the whole of «una respuesta que llega
 * tarde no escribe sobre otra nota».
 */
export function useIssueStates({
  relPath,
  issueIds,
  hasLinearApiKey,
}: {
  /** The transcript on screen, or null when none is selected. */
  relPath: string | null
  /** Every issue in the note's push history, in any order. */
  issueIds: readonly string[]
  /** Whether a key is stored. The key itself never reaches the browser. */
  hasLinearApiKey: boolean
}): IssueStatesApi {
  const [byPath, setByPath] = useState<Record<string, Report>>({})
  // Per note, bumped by «Reintentar»: a second failure is otherwise
  // indistinguishable from the first and the effect would not run again.
  const [attempts, setAttempts] = useState<Record<string, number>>({})
  /** Rounds whose request has been made, so an effect re-run does not re-ask. */
  const requested = useRef<Set<string>>(new Set())

  // A note nobody ever pushed has nothing to report, and asking would spend a
  // round trip to be told so; without a key the route would answer 400, which
  // is a message about /settings rather than about this meeting.
  const enabled = !!relPath && hasLinearApiKey && issueIds.length > 0
  const signature = useMemo(() => [...issueIds].sort().join(','), [issueIds])
  const requestKey = enabled && relPath ? `${attempts[relPath] ?? 0}:${relPath}:${signature}` : null

  useEffect(() => {
    if (!relPath || !requestKey || requested.current.has(requestKey)) return
    requested.current.add(requestKey)

    setByPath((previous) => ({
      ...previous,
      // The previous round's states are kept while the new ones load, so a
      // retry does not blank the badges it is about to refresh.
      [relPath]: {
        key: requestKey,
        status: 'loading',
        states: previous[relPath]?.states ?? NO_STATES,
        error: null,
      },
    }))

    const answer = (result: Omit<Report, 'key'>) =>
      setByPath((previous) => write(previous, relPath, { key: requestKey, ...result }))

    fetchIssueStates(relPath).then(
      (states) => answer({ status: 'ready', states, error: null }),
      (err: unknown) => answer({ status: 'error', states: NO_STATES, error: errorMessage(err) }),
    )
  }, [relPath, requestKey])

  // Only a report asked for under the current key is this note's answer: the
  // one left over from a round before the last push is about fewer issues than
  // the history now lists.
  const report = relPath && requestKey && byPath[relPath]?.key === requestKey
    ? byPath[relPath]
    : undefined
  const states = report?.status === 'ready' ? report.states : NO_STATES

  const byId = useMemo(
    () => (states.length > 0 ? issueStatesById(states) : NO_BY_ID),
    [states],
  )
  const summary = useMemo(
    () => (report?.status === 'ready' ? summarizeIssueStates(states) : null),
    [report?.status, states],
  )

  const retry = useCallback(() => {
    if (!relPath) return
    setAttempts((previous) => ({ ...previous, [relPath]: (previous[relPath] ?? 0) + 1 }))
  }, [relPath])

  return {
    status: statusOf(enabled, report),
    byId,
    summary,
    error: report?.status === 'error' ? report.error : null,
    retry,
  }
}

/**
 * What the block says about the report. Anything short of `ready` means there
 * are no states to show, which is never a reason to take the history away:
 * `unavailable` and `error` both leave it exactly as it was.
 */
function statusOf(enabled: boolean, report: Report | undefined): IssueStatesStatus {
  if (!enabled) return 'unavailable'
  if (report?.status === 'error') return 'error'
  if (report?.status === 'ready') return 'ready'
  return 'loading'
}

/**
 * The answer of a request, dropped when another round has already replaced it.
 * Two rounds for the same note can be in flight after a retry, and the older
 * one must not be the one that lands.
 */
function write(
  previous: Record<string, Report>,
  relPath: string,
  next: Report,
): Record<string, Report> {
  if (previous[relPath]?.key !== next.key) return previous
  return { ...previous, [relPath]: next }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'No se pudo consultar el estado de los issues en Linear.'
}
