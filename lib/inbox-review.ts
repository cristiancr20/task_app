/**
 * The review round: which extracted notes are still waiting to be sent, and
 * which one comes after the one open — as pure logic.
 *
 * A tanda leaves a pile: several notes with drafts on disk, none of them sent.
 * Working through that pile means opening a note, reading its table, pushing
 * it, and going to the next — and «the next» must not require going back to the
 * bandeja and finding the row by eye, which is the whole of the story this
 * module serves.
 *
 * «Pendiente de revisar» is not defined here twice: it is exactly the
 * `extracted` scope of `lib/inbox-scope.ts` — a note with drafts that has never
 * been pushed — so the tab in the bandeja and the round in the explorer are
 * structurally the same list, in the same order, and cannot disagree about what
 * is left.
 *
 * The order is the inbox's own (most recent first, undated last): it is what
 * the user just looked at, and a round that walked its rows in some other order
 * would feel like a different list.
 *
 * No React, no filesystem, no push: this answers «cuál es la siguiente» and
 * «por cuál voy», and whoever asks opens it.
 */

import type { InboxStatus } from './inbox'
import { scopeItems } from './inbox-scope'

/** What the round needs of a row: its path, its name and how far along it is. */
export type ReviewNote = {
  relPath: string
  title: string
  status: InboxStatus
}

/**
 * The notes waiting to be reviewed, in the order the bandeja lists them.
 *
 * Delegated to `scopeItems` rather than filtered again here, so «por revisar»
 * has one definition; like it, the input array comes back untouched when every
 * row already qualifies.
 */
export function reviewQueue<T extends ReviewNote>(items: readonly T[]): readonly T[] {
  return scopeItems(items, 'extracted')
}

/**
 * Where the open note sits in the round, 1-based; `0` when it is not in it.
 *
 * Zero is a real answer and a common one: the note that has just been pushed
 * leaves the inbox the moment the bandeja refreshes, so the very act of
 * finishing a review takes the open note out of the queue it was being counted
 * in. The label says «quedan N» in that case rather than a position that would
 * have to be invented.
 */
export function reviewPosition(queue: readonly ReviewNote[], current: string | null): number {
  if (!current) return 0
  return queue.findIndex((note) => note.relPath === current) + 1
}

/**
 * The next note to review after the one open, or null when there is no other.
 *
 * It wraps: the round is a pile, not a track with an end. A note skipped near
 * the top would otherwise be stranded once the bottom was reached — the only
 * way back to it being the bandeja, which is the trip this exists to avoid —
 * and a list that shrinks as notes are sent makes «the last one» a moving
 * target anyway.
 *
 * Null means «no queda otra»: an empty round, or one whose only remaining note
 * is the one already on screen. A note that is not in the round (never
 * extracted, or just sent) starts it from the top.
 */
export function nextToReview<T extends ReviewNote>(
  queue: readonly T[],
  current: string | null,
): T | null {
  if (queue.length === 0) return null

  const index = queue.findIndex((note) => note.relPath === current)
  if (index === -1) return queue[0]
  if (queue.length === 1) return null

  return queue[(index + 1) % queue.length]
}

/**
 * Where the round stands: `Nota 2 de 5 por revisar`, or `Quedan 4 por revisar`
 * when the open note is not one of them.
 *
 * Both halves are needed and they say different things. While the note being
 * read is in the queue, its position is what tells the user how much of the
 * tanda is behind them; the moment it is sent, the same bar has to stop
 * claiming a position and report what is left.
 */
export function reviewProgressLabel(position: number, total: number): string {
  if (total === 0) return 'No queda nada por revisar'
  if (position < 1 || position > total) {
    return total === 1 ? 'Queda 1 nota por revisar' : `Quedan ${total} notas por revisar`
  }

  return `Nota ${position} de ${total} por revisar`
}

/** What the «siguiente» control promises, named — or why it is refusing. */
export function nextReviewTitle(next: ReviewNote | null): string {
  return next ? `Abrir «${next.title}»` : 'No queda ninguna otra nota extraída sin enviar'
}
