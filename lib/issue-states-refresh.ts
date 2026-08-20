/**
 * When the open note's report is due to be read from Linear again.
 *
 * `app/use-issue-states.ts` owns the timer and the fetch; the question of
 * whether a given tick should turn into a request is arithmetic over four
 * facts, and it lives here for the same reason `lib/issue-state-summary.ts`
 * does — it is pure, and the test suite only collects `lib/**`.
 *
 * The same predicate answers both callers, which is the point of extracting
 * it: the interval's own tick and the tab coming back into view ask exactly
 * the same question, and neither may end up with a second query of a note that
 * is already being queried.
 */

/**
 * How long a note's report is treated as current before it is read again.
 *
 * A minute is chosen against what the report is for: it is read while a
 * meeting is being gone through, so a state somebody moved in Linear a moment
 * ago should show up without the page being reloaded, and nothing here is
 * urgent enough to poll faster. One open note polling at this rate is 60
 * requests an hour against Linear's budget — and only while the tab is in
 * front of the user, since `shouldRefresh` refuses to fire on a hidden tab.
 */
export const ISSUE_STATES_REFRESH_INTERVAL_MS = 60_000

export type RefreshInput = {
  /**
   * Whether there is anything to refresh at all: a note is open, a key is
   * stored, and that note actually created issues. A note with no history and
   * a workspace with no key never schedule a thing.
   */
  enabled: boolean
  /** `document.visibilityState === 'visible'`. */
  visible: boolean
  /** Whether a query of this same note is still in flight. */
  inFlight: boolean
  /**
   * When the last query of this note was *started* — started, not answered, so
   * a slow request cannot be followed by an immediate second one. `null` when
   * the note has never been asked about.
   */
  lastAskedAt: number | null
  /** Now, on the same clock as `lastAskedAt`. */
  now: number
  /** Exposed for the tests; the hook always uses the constant above. */
  intervalMs?: number
}

/**
 * Whether this moment should turn into a request.
 *
 * Every acceptance criterion of the background refresh that is not about
 * clearing a timer is one clause of this expression: nothing without a note,
 * a key and a history; nothing on a hidden tab; and never a second query of a
 * note whose first one has not come back.
 *
 * A clock that has moved backwards — the machine woke from sleep, the system
 * time was corrected — reads as due rather than as freshly asked, so the
 * report cannot get stuck until the clock catches up. It cannot storm either:
 * the caller stamps `lastAskedAt` with the new clock as it asks.
 */
export function shouldRefresh({
  enabled,
  visible,
  inFlight,
  lastAskedAt,
  now,
  intervalMs = ISSUE_STATES_REFRESH_INTERVAL_MS,
}: RefreshInput): boolean {
  if (!enabled || !visible || inFlight) return false
  if (lastAskedAt === null) return true
  const elapsed = now - lastAskedAt
  return elapsed < 0 || elapsed >= intervalMs
}
