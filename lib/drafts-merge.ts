import type { DraftsState } from './drafts-store'

/**
 * What a note's drafts become when a read comes back from `/api/drafts` —
 * which is not simply «what was read», because the read is asynchronous and
 * the table it belongs to has been on screen the whole time.
 *
 * Three cases, and the last one is the reason this is a function rather than
 * an assignment:
 *
 * 1. Nothing happened while the read was out: the stored state *is* the state.
 * 2. An extraction landed first, or an earlier read already filled the table —
 *    both leave a baseline behind. What is on screen replaces what was read,
 *    which is exactly the outcome a slow read must not be able to undo.
 * 3. Rows were typed into a table that could not be read: the shape of a
 *    «Reintentar» after a failed load. Neither side is stale — the user cannot
 *    have edited rows they never saw — so both are kept. Choosing either way
 *    round loses work silently: the disk over the table takes back rows the
 *    user just typed, and the table over the disk quietly replaces curation
 *    they never got to see.
 */
export function mergeDrafts(memory: DraftsState, stored: DraftsState): DraftsState {
  if (isEmpty(memory)) return stored
  if (memory.extracted || memory.baseline.length > 0) return memory

  // A page that never managed to read the file has no idea which keys it holds,
  // so a row typed meanwhile can carry one of them — and two rows on the same
  // key are one React key, one edit landing on both, and a «Eliminar» removing
  // the wrong one. Suffixing parts them, and cannot collide in turn: the
  // generator only ever mints `row-` followed by digits.
  const taken = new Set(stored.rows.map((row) => row.id))

  return {
    // The stored rows go first: they are the older work, and the row being
    // typed keeps its place at the end of the table where it was added.
    rows: [
      ...stored.rows,
      ...memory.rows.map((row) => (taken.has(row.id) ? { ...row, id: `${row.id}-b` } : row)),
    ],
    // The baseline and the extraction flag can only come from disk here: this
    // branch is what «the table has rows but no extraction behind them» means.
    baseline: stored.baseline,
    extracted: stored.extracted,
  }
}

/** Nothing a read would be overwriting. Mirrors the store's own emptiness. */
function isEmpty(state: DraftsState): boolean {
  return state.rows.length === 0 && state.baseline.length === 0 && !state.extracted
}
