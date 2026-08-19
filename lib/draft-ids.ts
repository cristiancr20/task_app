/**
 * The keys of the task table's rows.
 *
 * A row's id is what the table edits and removes rows by, and it now has to
 * outlive the page: drafts are restored from disk, so an id handed out after a
 * reload must not collide with one that came back. A counter restarted at zero
 * would hand `row-1` to a freshly added row while the restored `row-1` is still
 * on screen — two rows sharing a React key, one edit landing on both, and a
 * «Eliminar» removing the wrong one.
 *
 * The ids stay opaque strings on the wire: `reserve` reads the counter back out
 * of the ones it recognises and ignores the rest, so a draft saved by an older
 * version (or hand-edited in `drafts.json`) restores without being renamed.
 */

/** The shape this module hands out — `row-7` carries the counter in it. */
const MINTED = /^row-(\d+)$/

export type DraftIds = {
  /** A key no row has: neither one already handed out nor one reserved. */
  next(): string
  /** Take restored ids out of circulation before handing out new ones. */
  reserve(ids: Iterable<string>): void
}

export function createDraftIds(): DraftIds {
  let sequence = 0

  return {
    next: () => `row-${++sequence}`,

    reserve(ids) {
      for (const id of ids) {
        const match = MINTED.exec(id)
        if (!match) continue

        // A number past the safe range would stop incrementing — the counter
        // is better left where it is, since such an id was never minted here.
        const value = Number(match[1])
        if (Number.isSafeInteger(value) && value > sequence) sequence = value
      }
    },
  }
}
