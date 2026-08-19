/**
 * The duplicate check, as arithmetic over rows and issues.
 *
 * `lib/similarity.ts` answers how alike two titles are; this module answers
 * the question the table actually asks — which row of *this* note already
 * exists in *this* destination, whether that is enough to call it a duplicate,
 * and which rows still have to be scored because the user retyped them.
 *
 * It lives here rather than in `app/use-duplicate-check.ts` for the same
 * reason `countManualChanges` does: it is pure, and the test suite only
 * collects `lib/**`. The hook is left with the parts that are genuinely about
 * React — the fetch, the debounce and the state keyed by path.
 *
 * The import of `lib/linear.ts` is type-only on purpose: that module reads
 * `process.env` and handles the API key, and none of it may reach the browser
 * bundle this code runs in.
 */

import type { ExistingIssue } from './linear'
import { bestMatch, DUPLICATE_THRESHOLD } from './similarity'

/** The destination a check was made against: a team, optionally narrowed. */
export type DuplicateScope = {
  teamId: string
  /** The project the push is aimed at, or null for the whole team. */
  projectId: string | null
}

/** The closest thing the destination already holds to one row of the table. */
export type DuplicateMatch = {
  /** Between 0 and 1 — `similarity` between the row's title and the issue's. */
  score: number
  /** The human key, e.g. `ENG-42`. */
  identifier: string
  /** The issue's title, so the user can judge the match rather than the number. */
  title: string
  url: string
  /**
   * The issue's state is of type completed or cancelled. It is reported apart
   * from `duplicate` because it means something different: the work was done
   * (or dropped) once already, which is worth reading before pushing, but is
   * not by itself a reason to stop — see `isOpenDuplicate`.
   */
  closed: boolean
  /** The score reaches `DUPLICATE_THRESHOLD`: this is the same task. */
  duplicate: boolean
}

/** All this module needs of a table row. `TaskDraft` structurally is one. */
export type CheckableRow = {
  id: string
  title: string
}

/** One row's result, and the title it was computed from. */
export type RowCheck = {
  /**
   * The title that was scored. Kept so an edit invalidates the result without
   * anybody having to remember to clear it: a check whose title no longer
   * matches the row is simply not this row's answer any more.
   */
  title: string
  /** The best match, or null when nothing in the destination looks like it. */
  match: DuplicateMatch | null
}

/** Every checked row of one note, by row id. */
export type RowChecks = Record<string, RowCheck>

/** What one transcript's check amounts to, and what it was made against. */
export type PathChecks = {
  /** The destination these results describe — see `scopeKeyOf`. */
  scopeKey: string
  /** Which round of «Buscar duplicados» produced them. */
  attempt: number
  checks: RowChecks
}

/** Not a character an id can hold, so the two halves can never run together. */
const KEY_SEPARATOR = '\u0000'

/**
 * The destination as one comparable string, or null when there is none.
 *
 * The issues of a destination are fetched once and reused for every note, so
 * something has to say when two destinations are the same one — and a fresh
 * `{ teamId, projectId }` object per render says nothing. A blank team is no
 * destination at all: there is nothing to query.
 */
export function scopeKeyOf(scope: DuplicateScope | null | undefined): string | null {
  const teamId = scope?.teamId.trim() ?? ''
  if (!teamId) return null
  return `${teamId}${KEY_SEPARATOR}${scope?.projectId?.trim() ?? ''}`
}

/** The scope a key was built from, for the request it identifies. */
export function scopeFromKey(key: string): DuplicateScope {
  const cut = key.indexOf(KEY_SEPARATOR)
  if (cut === -1) return { teamId: key, projectId: null }
  return { teamId: key.slice(0, cut), projectId: key.slice(cut + 1) || null }
}

/**
 * The lowest score worth putting on screen.
 *
 * `similarity` never reaches 0 between two real Spanish titles — they share
 * `de`, `os`, `ci` and the rest by accident, which is worth around 0.09 for
 * nothing — so «the closest issue» is not the same question as «is there a
 * match at all». 0.3 is where the measurements behind `DUPLICATE_THRESHOLD`
 * put the ceiling of unrelated pairs, so anything under it is the arithmetic
 * talking rather than the tasks, and the row is better off reported as clean
 * than as a 9% match nobody would make.
 */
const MIN_REPORTED_SCORE = 0.3

/**
 * The issue that looks most like this title, or null when none of them does.
 */
export function matchIssue(
  title: string,
  issues: readonly ExistingIssue[],
): DuplicateMatch | null {
  const best = bestMatch(title, issues, (issue) => issue.title)
  if (!best || best.score < MIN_REPORTED_SCORE) return null

  return {
    score: best.score,
    identifier: best.item.identifier,
    title: best.item.title,
    url: best.item.url,
    closed: best.item.closed,
    // At the threshold and above. `DUPLICATE_THRESHOLD` is the middle of a gap
    // measured between real reformulations and merely related tasks, so no
    // observed pair lands exactly on it — but the constant is documented as
    // «the score at which two titles are the same task», and this is that.
    duplicate: best.score >= DUPLICATE_THRESHOLD,
  }
}

/**
 * The result for every row given, reusing what is still valid.
 *
 * Rows left out — the ones already created in this push, and the ones the user
 * deleted — get no entry at all, which is how they stop being reported without
 * a second list of exclusions to keep in sync. A row whose title still matches
 * its previous check keeps that very object, so re-running this after a single
 * keystroke scores one row rather than the whole table.
 */
export function checkRows(
  rows: readonly CheckableRow[],
  issues: readonly ExistingIssue[],
  previous: RowChecks = {},
): RowChecks {
  const checks: RowChecks = {}
  for (const row of rows) {
    const before = previous[row.id]
    checks[row.id] =
      before && before.title === row.title
        ? before
        : { title: row.title, match: matchIssue(row.title, issues) }
  }
  return checks
}

/** The rows with no result, or whose result is about a title they no longer have. */
export function pendingRowIds(rows: readonly CheckableRow[], checks: RowChecks): string[] {
  return rows.filter((row) => checks[row.id]?.title !== row.title).map((row) => row.id)
}

/**
 * Whether a check is due: some row is unscored or was retyped, the destination
 * changed under the results, or «Buscar duplicados» asked for a fresh round.
 *
 * A table with no rows is never due — there is nothing to compare, and asking
 * would only spend the destination's issue listing on an empty note.
 */
export function needsCheck(
  rows: readonly CheckableRow[],
  entry: PathChecks | undefined,
  expected: { scopeKey: string; attempt: number },
): boolean {
  if (rows.length === 0) return false
  if (!entry) return true
  if (entry.scopeKey !== expected.scopeKey || entry.attempt !== expected.attempt) return true
  return pendingRowIds(rows, entry.checks).length > 0
}

/**
 * What the table may show right now, by row id: the results of the destination
 * currently selected, for the titles currently on screen.
 *
 * Everything else is dropped rather than shown stale — a result computed
 * against another project, or against a title the user has since rewritten, is
 * an answer to a question nobody is asking any more. The rewritten row simply
 * has no entry until the re-check lands, which is what makes an edit clear its
 * own badge.
 */
export function matchesOf(
  rows: readonly CheckableRow[],
  entry: PathChecks | undefined,
  scopeKey: string | null,
): Record<string, DuplicateMatch | null> {
  const matches: Record<string, DuplicateMatch | null> = {}
  if (!entry || !scopeKey || entry.scopeKey !== scopeKey) return matches

  for (const row of rows) {
    const check = entry.checks[row.id]
    if (check && check.title === row.title) matches[row.id] = check.match
  }
  return matches
}

/**
 * A duplicate of something still open — the one case where creating the issue
 * would put two live copies of the same task in the same project.
 *
 * A match against a completed or cancelled issue is deliberately not one: the
 * task was done before and is being asked for again, which is ordinary, so it
 * is reported and left to the user.
 */
export function isOpenDuplicate(match: DuplicateMatch | null | undefined): boolean {
  return !!match && match.duplicate && !match.closed
}
