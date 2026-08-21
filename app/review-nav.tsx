'use client'

import { nextReviewTitle, type ReviewNote, reviewProgressLabel } from '@/lib/inbox-review'

type Props = {
  /** Where the open note sits in the round, 1-based; `0` when it is not in it. */
  position: number
  /** How many notes are extracted and still unsent, right now. */
  total: number
  /** The note «Siguiente» would open, or null when there is no other. */
  next: ReviewNote | null
  onNext: () => void
}

/**
 * The round, as a strip at the top of the Linear column: how much of the tanda
 * is left, and the one control that moves to the next note of it.
 *
 * A tanda leaves several notes with drafts and no push, and closing it means
 * reading each table and sending it. Without this, «la siguiente» costs opening
 * the bandeja, finding the row among the untouched ones and clicking it — three
 * moves, repeated per note, for something that is a queue by then.
 *
 * It deliberately does **not** send anything. The push stays what it was: one
 * note, its own panel below this strip, its own destination and its own review.
 * Sending a whole tanda from here would be a batch nobody read, which is the
 * one thing the review round exists to prevent.
 *
 * It is drawn only while there is a round — nothing is left, nothing appears —
 * and it counts against `counts.extracted`, the same list the bandeja's «Por
 * revisar» tab holds, so pushing a note takes it out of both at once.
 */
export function ReviewNav({ position, total, next, onNext }: Props) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line bg-accent-wash px-3 py-1.5">
      <p aria-live="polite" className="min-w-0 truncate text-xs font-medium text-content">
        {reviewProgressLabel(position, total)}
        {/* The note it would open, when there is room for it: «siguiente» is
            worth trusting only if it says which one. */}
        {next ? <span className="font-normal text-muted"> · sigue «{next.title}»</span> : null}
      </p>

      <button
        type="button"
        onClick={onNext}
        disabled={!next}
        title={nextReviewTitle(next)}
        className="flex shrink-0 items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Siguiente
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6,3.5 10.5,8 6,12.5" />
        </svg>
      </button>
    </div>
  )
}
