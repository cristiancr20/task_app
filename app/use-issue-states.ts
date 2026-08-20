'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchIssueStates } from '@/lib/issue-states-client'
import {
  type IssueStateSummary,
  issueStatesById,
  summarizeIssueStates,
} from '@/lib/issue-state-summary'
import { ISSUE_STATES_REFRESH_INTERVAL_MS, shouldRefresh } from '@/lib/issue-states-refresh'
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
  /** A query is in flight over states that are already on screen. */
  refreshing: boolean
  /**
   * The last refresh failed while a good report stayed on screen, in Spanish,
   * or null. It is a footnote to the counters and never a replacement for
   * them: what is shown is still true, it is just not known to be current.
   */
  refreshError: string | null
  /** Ask again now: «Reintentar» after a failure, «Actualizar» over a report. */
  refresh: () => void
}

/** One note's report, as one request's worth of state. */
type Report = {
  /** What it is about: the note, and the exact ids it was asked for. */
  dataKey: string
  /** The round that asked for it, so a superseded answer is not written. */
  key: string
  status: 'loading' | 'ready' | 'error'
  /** Another round is in flight over the states below, which stay on screen. */
  refreshing: boolean
  states: IssueState[]
  /** Why there is nothing to show. Only ever set with `status: 'error'`. */
  error: string | null
  /** Why what is shown may be out of date. Only ever set over a good report. */
  refreshError: string | null
}

const NO_STATES: IssueState[] = []
const NO_BY_ID: Record<string, IssueState> = {}

/**
 * What became of the issues the selected note created, kept up to date while
 * the note is open.
 *
 * Keyed by path like the drafts, the push run and the duplicate check: the
 * explorer does not unmount this panel when the selection changes, so the
 * report of one meeting must never be read as another's. That is also what
 * makes the cache a cache — browsing away and back shows the answer again
 * without a second round trip, for as long as the page is open.
 *
 * Two keys, not one, because a note's report is re-read for two different
 * reasons. `dataKey` is what the report is *about* — the note and the ids in
 * its history — and it is what decides whether an entry may be rendered at
 * all: a push that adds issues invalidates the report by itself, since the ids
 * it was computed from are no longer the note's. `key` is which *round* asked,
 * and it only decides whose answer is allowed to land. A background refresh
 * bumps the round and leaves the data key alone, so the counters on screen do
 * not blink back to «Consultando…» once a minute.
 *
 * The refresh cycle belongs to the open note: it is a single interval, started
 * only for a note that has something to ask about, stopped while the tab is
 * hidden, skipped whenever the previous query has not come back, and torn down
 * when the selection changes or the panel unmounts. `lib/issue-states-refresh.ts`
 * holds the decision itself, where it can be tested.
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
  // Per note, bumped by every «Actualizar», «Reintentar» and background tick:
  // a second query is otherwise indistinguishable from the first and the
  // request effect would not run again.
  const [rounds, setRounds] = useState<Record<string, number>>({})
  /** Rounds whose request has been made, so an effect re-run does not re-ask. */
  const requested = useRef<Set<string>>(new Set())
  /** Notes with a query in flight, so a tick never overlaps one. */
  const inFlight = useRef<Set<string>>(new Set())
  /** When each note was last *asked* about, which is what freshness is of. */
  const askedAt = useRef<Map<string, number>>(new Map())

  // A note nobody ever pushed has nothing to report, and asking would spend a
  // round trip to be told so; without a key the route would answer 400, which
  // is a message about /settings rather than about this meeting. Neither ever
  // gets a request, and therefore neither ever gets a timer.
  const enabled = !!relPath && hasLinearApiKey && issueIds.length > 0
  const signature = useMemo(() => [...issueIds].sort().join(','), [issueIds])
  const dataKey = enabled && relPath ? `${relPath}:${signature}` : null
  const requestKey = dataKey && relPath ? `${rounds[relPath] ?? 0}:${dataKey}` : null

  useEffect(() => {
    if (!relPath || !dataKey || !requestKey || requested.current.has(requestKey)) return
    requested.current.add(requestKey)
    inFlight.current.add(relPath)
    askedAt.current.set(relPath, Date.now())

    setByPath((previous) => opened(previous, relPath, dataKey, requestKey))

    const settle = (next: (previous: Record<string, Report>) => Record<string, Report>) => {
      inFlight.current.delete(relPath)
      setByPath(next)
    }

    fetchIssueStates(relPath).then(
      (states) => settle((previous) => landed(previous, relPath, requestKey, states)),
      (err: unknown) =>
        settle((previous) => failed(previous, relPath, requestKey, errorMessage(err))),
    )
  }, [relPath, dataKey, requestKey])

  /** Start another round for the note on screen, unless one is already running. */
  const ask = useCallback(() => {
    if (!relPath || !enabled || inFlight.current.has(relPath)) return
    setRounds((previous) => ({ ...previous, [relPath]: (previous[relPath] ?? 0) + 1 }))
  }, [relPath, enabled])

  /** One beat of the cycle: ask only if this is a moment that deserves it. */
  const tick = useCallback(() => {
    if (!relPath) return
    const due = shouldRefresh({
      enabled,
      visible: document.visibilityState === 'visible',
      inFlight: inFlight.current.has(relPath),
      lastAskedAt: askedAt.current.get(relPath) ?? null,
      now: Date.now(),
    })
    if (due) ask()
  }, [relPath, enabled, ask])

  useEffect(() => {
    // Nothing to ask about is nothing to schedule: no key, no history and no
    // open note each mean no interval and no listener exist at all.
    if (!enabled || !relPath) return

    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer === null) timer = setInterval(tick, ISSUE_STATES_REFRESH_INTERVAL_MS)
    }
    const stop = () => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }

    // A tab in the background is a tab nobody is reading: polling it would
    // spend Linear's quota on a report nobody can see. Coming back is the
    // moment the report matters most, so it catches up before resuming.
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        stop()
        return
      }
      tick()
      start()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Selecting another note, or unmounting the explorer, ends this note's
    // cycle here — there is no timer left behind to fire against it.
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, relPath, tick])

  // Only a report about the note and the ids now on screen is this note's
  // answer: the one left over from before the last push is about fewer issues
  // than the history lists. Which round produced it does not matter here —
  // that is the write guard's business.
  const report = relPath && dataKey && byPath[relPath]?.dataKey === dataKey
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

  return {
    status: statusOf(enabled, report),
    byId,
    summary,
    error: report?.status === 'error' ? report.error : null,
    refreshing: report?.refreshing ?? false,
    refreshError: report?.status === 'ready' ? report.refreshError : null,
    refresh: ask,
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
 * The entry a round starts from.
 *
 * A report already answered for these very ids stays exactly as it is and only
 * gains a `refreshing` flag: a refresh — on the interval or on «Actualizar» —
 * must not blank the counters it is about to confirm. Anything else is a first
 * read, and reads as one.
 */
function opened(
  previous: Record<string, Report>,
  relPath: string,
  dataKey: string,
  key: string,
): Record<string, Report> {
  const shown = previous[relPath]
  const carried = shown?.dataKey === dataKey && shown.status === 'ready' ? shown : null
  return {
    ...previous,
    [relPath]: carried
      ? { ...carried, key, refreshing: true, refreshError: null }
      : {
          dataKey,
          key,
          status: 'loading',
          refreshing: false,
          states: NO_STATES,
          error: null,
          refreshError: null,
        },
  }
}

/**
 * The answer of a request, dropped when another round has already replaced it.
 * Two rounds for the same note can only overlap after a note is reopened
 * mid-flight, and the older one must not be the one that lands.
 */
function landed(
  previous: Record<string, Report>,
  relPath: string,
  key: string,
  states: IssueState[],
): Record<string, Report> {
  const entry = previous[relPath]
  if (entry?.key !== key) return previous
  return {
    ...previous,
    [relPath]: { ...entry, status: 'ready', refreshing: false, states, error: null, refreshError: null },
  }
}

/**
 * A failure, which never takes an answer away.
 *
 * Over a report that was read successfully — the refresh case — the states
 * stay, and all that changes is a footnote saying they could not be brought up
 * to date; the next tick will try again. Only a note that has nothing to show
 * yet reads the failure as its state, which is what «Reintentar» is next to.
 */
function failed(
  previous: Record<string, Report>,
  relPath: string,
  key: string,
  message: string,
): Record<string, Report> {
  const entry = previous[relPath]
  if (entry?.key !== key) return previous
  if (entry.status === 'ready') {
    return { ...previous, [relPath]: { ...entry, refreshing: false, refreshError: message } }
  }
  return {
    ...previous,
    [relPath]: {
      ...entry,
      status: 'error',
      refreshing: false,
      states: NO_STATES,
      error: message,
      refreshError: null,
    },
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'No se pudo consultar el estado de los issues en Linear.'
}
