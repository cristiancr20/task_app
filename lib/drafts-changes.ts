/**
 * How far a note's table has drifted from the last extraction.
 *
 * It lives here rather than in `app/use-task-drafts.ts` because it is pure
 * arithmetic over two lists of rows — no React, no fetch, nothing that needs a
 * browser — and because that is the only way it can be covered by the test
 * suite, which collects test files under `lib/` alone and runs without a DOM.
 *
 * The rows it compares are `DraftRow`s: `TaskDraft` in the table adds nothing
 * to the stored shape, so what is on screen and what is on disk are counted by
 * the very same rules.
 */

import type { DraftRow } from './drafts-store'

/** How far the table has drifted from the last extraction, in rows. */
export type ManualChanges = {
  edited: number
  added: number
  removed: number
  /** Rows the user touched in any way — what a regenerate would discard. */
  total: number
}

export const NO_CHANGES: ManualChanges = { edited: 0, added: 0, removed: 0, total: 0 }

/** The two lists the count is made of, and all it needs of a table's state. */
export type ChangeableDrafts = {
  rows: DraftRow[]
  /** The rows exactly as the last extraction returned them. Never edited. */
  baseline: DraftRow[]
}

/**
 * The manual changes since the last extraction, counted in rows rather than in
 * keystrokes: a title typed one character at a time is one edited row, and the
 * number has to be one the user recognises before agreeing to lose it.
 *
 * Unchecking «incluir» counts as an edit. It is curation work like any other,
 * and a regenerate wipes it just the same — so does correcting a date the
 * model read wrong, which is the whole reason the column is editable.
 */
export function countManualChanges(state: ChangeableDrafts | undefined): ManualChanges {
  if (!state) return NO_CHANGES

  const original = new Map(state.baseline.map((row) => [row.id, row]))
  let edited = 0
  let added = 0
  let kept = 0

  for (const row of state.rows) {
    const before = original.get(row.id)
    if (!before) added += 1
    else {
      kept += 1
      if (!sameDraft(before, row)) edited += 1
    }
  }

  const removed = state.baseline.length - kept
  return { edited, added, removed, total: edited + added + removed }
}

/**
 * Every field the user can change, and no others: two rows the user cannot
 * tell apart on screen must not be counted as an edit. `evidence` is compared
 * even though nothing edits it — a row whose proof changed is a different row.
 */
function sameDraft(a: DraftRow, b: DraftRow): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.priority === b.priority &&
    a.mentioned === b.mentioned &&
    a.dueDate === b.dueDate &&
    a.evidence === b.evidence &&
    a.include === b.include
  )
}
