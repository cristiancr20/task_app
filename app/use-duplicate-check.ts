'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  type CheckableRow,
  checkRows,
  type DuplicateMatch,
  type DuplicateScope,
  matchesOf,
  needsCheck,
  type PathChecks,
  scopeFromKey,
  scopeKeyOf,
} from '@/lib/duplicate-check'
import type { ExistingIssue } from '@/lib/linear'
import { fetchLinearIssues } from '@/lib/linear-client'

/**
 * How long a title has to sit still before it is scored again. The check
 * itself is arithmetic and costs nothing, but its result is a badge next to
 * the row: recomputing it per keystroke would flicker «ya existe» on and off
 * while the user is still typing the title it is about.
 */
const CHECK_DELAY_MS = 400

/**
 * Where the check stands. `unavailable` is not a failure and neither is
 * `error`: both mean «we do not know», which is the answer the push is allowed
 * to proceed on — nothing here ever blocks it.
 */
export type DuplicateCheckStatus = 'unavailable' | 'loading' | 'ready' | 'error'

export type DuplicateCheckApi = {
  status: DuplicateCheckStatus
  /**
   * The best match of every row that has been checked against the destination
   * now selected, by row id — null for a row nothing resembles. A row that is
   * missing has no answer yet: it was just added, its title has just changed,
   * or the check has never run.
   */
  matches: Record<string, DuplicateMatch | null>
  /** The issues are on their way, or a re-check is about to run. */
  checking: boolean
  /** Why the destination's issues could not be read, in Spanish, or null. */
  error: string | null
  /** «Buscar duplicados»: read the destination again and re-score every row. */
  recheck: () => void
}

/** The issues of one destination, as one request's worth of state. */
type IssueCache = {
  /** The round that asked for them, so a superseded answer is not written. */
  key: string
  status: 'loading' | 'ready' | 'error'
  issues: ExistingIssue[]
  error: string | null
}

const NO_ISSUES: ExistingIssue[] = []

/**
 * Whether each row of a note already exists in the push destination.
 *
 * Two things are cached, and they are cached differently. The destination's
 * issues belong to the *destination*: they are fetched once per team/project
 * and reused for every note, because browsing from one meeting to the next
 * does not change what Linear holds. The results belong to the *note*, so they
 * are keyed by path like the drafts and the push run — the panel is not
 * unmounted when the selection changes, and one meeting's duplicates must
 * never be read as another's.
 *
 * Everything asynchronous is written under the key it was asked for: the
 * issues under their destination and their round, the results under their path
 * and destination. A slow answer arriving after the user has moved on lands on
 * its own key and is then ignored, rather than on whatever is on screen.
 */
export function useDuplicateCheck({
  relPath,
  scope,
  rows,
  skipRowIds,
}: {
  /** The transcript on screen, or null when none is selected. */
  relPath: string | null
  /** The push destination, or null when there is none to check against. */
  scope: DuplicateScope | null
  /** The rows of the table, in any shape that carries an id and a title. */
  rows: readonly CheckableRow[]
  /**
   * Rows already created by this push. They are in Linear because the user put
   * them there a moment ago, so scoring them would report every one of them as
   * a duplicate of itself.
   */
  skipRowIds?: ReadonlySet<string>
}): DuplicateCheckApi {
  const [cache, setCache] = useState<Record<string, IssueCache>>({})
  const [byPath, setByPath] = useState<Record<string, PathChecks>>({})
  // Bumped by «Buscar duplicados». Without it a re-check would find every row
  // already scored and every destination already fetched, and do nothing.
  const [attempt, setAttempt] = useState(0)
  /** Rounds whose request has been made, so an effect re-run does not re-ask. */
  const requested = useRef<Set<string>>(new Set())

  const scopeKey = scopeKeyOf(scope)
  const requestKey = scopeKey ? `${attempt}:${scopeKey}` : null

  const checkable = useMemo(
    () => rows.filter((row) => !skipRowIds?.has(row.id)),
    [rows, skipRowIds],
  )
  // What the rows amount to for this check: their ids and their titles. It is
  // a string so a re-render with an equal-but-new array does not restart the
  // debounce, and so that editing anything else in a row does not either.
  const signature = useMemo(
    () => checkable.map((row) => `${row.id}:${row.title}`).join('\n'),
    [checkable],
  )

  const cached = scopeKey ? cache[scopeKey] : undefined
  const issues = cached?.status === 'ready' ? cached.issues : NO_ISSUES
  const entry = relPath ? byPath[relPath] : undefined
  const due =
    !!relPath &&
    !!scopeKey &&
    cached?.status === 'ready' &&
    needsCheck(checkable, entry, { scopeKey, attempt })

  // Read by the debounced check when it eventually fires, so it always scores
  // what is on screen at that moment rather than what was there when it was
  // scheduled. Updated before the effect below, which is declared after it.
  const latest = useRef<{ rows: readonly CheckableRow[]; issues: ExistingIssue[]; key: string }>({
    rows: [],
    issues: NO_ISSUES,
    key: '',
  })
  useEffect(() => {
    latest.current = { rows: checkable, issues, key: scopeKey ?? '' }
  })

  // The destination's issues, once per destination and per round of the
  // button. A failure is kept as the destination's state rather than retried:
  // the check is not conclusive, the panel says so, and the button is how the
  // user asks again.
  useEffect(() => {
    if (!scopeKey || !requestKey || requested.current.has(requestKey)) return
    requested.current.add(requestKey)

    setCache((previous) => ({
      ...previous,
      // The issues of the previous round are kept while the new ones load, so
      // a manual re-check does not blank the badges it is about to refresh.
      [scopeKey]: {
        key: requestKey,
        status: 'loading',
        issues: previous[scopeKey]?.issues ?? NO_ISSUES,
        error: null,
      },
    }))

    const answer = (result: Omit<IssueCache, 'key'>) =>
      setCache((previous) => write(previous, scopeKey, { key: requestKey, ...result }))

    fetchLinearIssues(scopeFromKey(scopeKey)).then(
      (loaded) => answer({ status: 'ready', issues: loaded, error: null }),
      (err: unknown) => answer({ status: 'error', issues: NO_ISSUES, error: errorMessage(err) }),
    )
  }, [requestKey, scopeKey])

  // The scoring itself, debounced. It runs when a row has no result — a fresh
  // extraction, a row added by hand — when a title changed, when the
  // destination changed, and when the button asked for a new round.
  useEffect(() => {
    if (!due || !relPath || !scopeKey) return
    const path = relPath
    const key = scopeKey
    const round = attempt

    const handle = setTimeout(() => {
      // The destination changed between scheduling and firing: this timer is
      // cleared by the cleanup below when that happens, so this is a backstop
      // rather than the mechanism — but writing another project's scores under
      // this note is not a mistake worth risking on effect ordering.
      if (latest.current.key !== key) return
      const { rows: current, issues: against } = latest.current

      setByPath((previous) => {
        const before = previous[path]
        // Only the results of this very destination are worth reusing; the
        // rest are re-scored from scratch.
        const reusable = before?.scopeKey === key ? before.checks : {}
        return {
          ...previous,
          [path]: { scopeKey: key, attempt: round, checks: checkRows(current, against, reusable) },
        }
      })
    }, CHECK_DELAY_MS)

    return () => clearTimeout(handle)
  }, [attempt, due, relPath, scopeKey, signature])

  const matches = useMemo(
    () => matchesOf(checkable, entry, scopeKey),
    [checkable, entry, scopeKey],
  )

  const recheck = useCallback(() => setAttempt((previous) => previous + 1), [])

  return {
    status: statusOf(scopeKey, cached),
    matches,
    checking: cached?.status === 'loading' || due,
    error: cached?.status === 'error' ? cached.error : null,
    recheck,
  }
}

/**
 * What the panel says about the check. Anything short of `ready` means the
 * rows have no answer, which is not the same as «no duplicates» — and is
 * exactly why none of these states stops a push.
 */
function statusOf(scopeKey: string | null, cached: IssueCache | undefined): DuplicateCheckStatus {
  if (!scopeKey) return 'unavailable'
  if (cached?.status === 'error') return 'error'
  if (cached?.status === 'ready') return 'ready'
  return 'loading'
}

/**
 * The answer of a request, dropped when another round has already replaced it.
 * Two rounds against the same destination can be in flight after a re-check,
 * and the older one must not be the one that lands.
 */
function write(
  previous: Record<string, IssueCache>,
  scopeKey: string,
  next: IssueCache,
): Record<string, IssueCache> {
  if (previous[scopeKey]?.key !== next.key) return previous
  return { ...previous, [scopeKey]: next }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'No se pudieron comprobar los duplicados en Linear.'
}
