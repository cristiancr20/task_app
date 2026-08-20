/**
 * The quick filter of the file list, as pure logic.
 *
 * This is not the search. The search asks the server about every note under
 * the root; this narrows the listing of the folder that is already on screen,
 * in the browser, over an array that has already been fetched — so it makes no
 * request, answers on the keystroke, and disappears the moment the folder
 * changes.
 *
 * What it matches on is the two strings a row is recognised by: the title it
 * shows and the file name it was written to. Both are compared folded — the
 * same fold the search matches on — so «reunion» finds «Reunión» and
 * «RETRO» finds `retro-agosto.md`.
 */

import { foldText } from './search'

/** What the filter needs of a row: the two strings it matches on. */
export type FilterableFile = {
  title: string
  fileName: string
}

/** A folder's listing, narrowed — and everything the header has to say. */
export type FilteredFiles<T> = {
  /** The needle as it was matched: folded and trimmed. Empty when inactive. */
  query: string
  /** Whether anything is being filtered out at all. */
  active: boolean
  /** The rows to show. The input array itself while the filter is empty. */
  files: readonly T[]
  /** How many rows the folder has, filtered or not. */
  total: number
}

/**
 * Normalise what was typed into the needle to match with.
 *
 * A field holding only spaces is a field nobody filtered by, which is why the
 * result is trimmed: the fold has already collapsed the runs inside it, so an
 * inner space is kept and «acta de» still matches «Acta  de cierre».
 *
 * Unlike `prepareQuery`, there is no minimum length. A single letter is a
 * useless *search* — it reads every note on disk to answer — but a perfectly
 * good filter over the twenty rows already in front of the user.
 */
export function prepareFilter(raw: string): string {
  return foldText(raw).trim()
}

/**
 * Whether one row survives a needle that `prepareFilter` already normalised.
 *
 * An empty needle matches everything, which is what makes «no filter» and «a
 * filter that happens to be empty» the same case for every caller.
 */
export function fileMatchesFilter(file: FilterableFile, query: string): boolean {
  if (!query) return true
  return foldText(file.title).includes(query) || foldText(file.fileName).includes(query)
}

/**
 * The listing to draw, plus the two numbers the header shows.
 *
 * With nothing typed the very same array comes back, so the common case costs
 * one fold of an empty string and React sees no new list to reconcile.
 */
export function filterFiles<T extends FilterableFile>(
  files: readonly T[],
  raw: string,
): FilteredFiles<T> {
  const query = prepareFilter(raw)
  if (!query) return { query, active: false, files, total: files.length }

  return {
    query,
    active: true,
    files: files.filter((file) => fileMatchesFilter(file, query)),
    total: files.length,
  }
}
