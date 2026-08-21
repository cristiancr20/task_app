/**
 * Which slice of the bandeja is on screen, as pure logic.
 *
 * The inbox holds two kinds of pending note and the next step is not the same
 * for them: one has never been touched and needs extracting, the other already
 * carries drafts and needs *reviewing and sending*. Once a tanda has run, that
 * second pile is the whole of the work left, and a list that mixes it with
 * thirty untouched notes makes the user do the filtering by eye.
 *
 * This is not `lib/file-filter.ts`. That one narrows by what was typed; this
 * one narrows by what has been *done* to a note, which is a fact the row
 * already carries (`InboxStatus`). They compose in that order — scope first,
 * text second — so «3 de 12» always counts the rows on screen against every
 * pending note, whichever of the two is on.
 *
 * Nothing here reads the filesystem, imports React or knows about the queue: it
 * takes rows and a scope and answers rows, plus the words the tabs are drawn
 * with, so the labels cannot drift between the bandeja and the review round in
 * `lib/inbox-review.ts`.
 */

import type { InboxCounts, InboxStatus } from './inbox'

/**
 * The three ways of looking at the bandeja.
 *
 * `all` is everything pending; `untouched` is what still has to be extracted;
 * `extracted` is what has been extracted and not sent — the review pile, and
 * the reason this module exists.
 */
export type InboxScope = 'all' | 'untouched' | 'extracted'

/** In the order the tabs are drawn: the whole, then each half of it. */
export const INBOX_SCOPES: readonly InboxScope[] = ['all', 'untouched', 'extracted']

/** The scope nothing has narrowed: what the bandeja opens on. */
export const DEFAULT_INBOX_SCOPE: InboxScope = 'all'

/** What a scope needs of a row: how far along the note is. */
export type ScopedNote = {
  status: InboxStatus
}

/**
 * The rows a scope leaves on screen.
 *
 * `all` — and any scope that happens to match everything — returns the *input
 * array itself*, so the common case reconciles no new list in React and the
 * filter downstream sees the same identity it saw before.
 */
export function scopeItems<T extends ScopedNote>(
  items: readonly T[],
  scope: InboxScope,
): readonly T[] {
  if (scope === 'all') return items

  const kept = items.filter((item) => item.status === scope)
  return kept.length === items.length ? items : kept
}

/**
 * How many rows a scope holds, out of the counts the inbox already produced.
 *
 * The tabs show their own number, and it has to be the number of the whole
 * bandeja rather than of what the text filter left — a tab that said `0` while
 * holding four notes the filter is hiding would be a way out that looks closed.
 */
export function scopeCount(counts: InboxCounts, scope: InboxScope): number {
  switch (scope) {
    case 'all':
      return counts.total
    case 'untouched':
      return counts.untouched
    case 'extracted':
      return counts.extracted
  }
}

/** What the tab says. */
export function scopeLabel(scope: InboxScope): string {
  switch (scope) {
    case 'all':
      return 'Todas'
    case 'untouched':
      return 'Sin tocar'
    case 'extracted':
      return 'Por revisar'
  }
}

/** What the tab says when it is read out or hovered — the label, spelled out. */
export function scopeTitle(scope: InboxScope): string {
  switch (scope) {
    case 'all':
      return 'Todas las notas sin enviar'
    case 'untouched':
      return 'Notas sin borrador: todavía hay que extraerlas'
    case 'extracted':
      return 'Notas ya extraídas y sin enviar: son las que hay que revisar'
  }
}

/**
 * Why this scope is showing nothing, when the bandeja itself is not empty.
 *
 * A tab that empties the list without a word reads as a bandeja that lost its
 * notes; what happened is that every pending note is on the *other* tab, and
 * which one it is is the useful half of the sentence.
 */
export function scopeEmptyLabel(scope: InboxScope): string {
  switch (scope) {
    case 'all':
      return 'No queda ninguna nota pendiente.'
    case 'untouched':
      return 'Todas las notas pendientes tienen ya un borrador extraído.'
    case 'extracted':
      return 'Ninguna nota pendiente tiene borrador todavía: extrae alguna y volverá aquí para revisarla.'
  }
}
