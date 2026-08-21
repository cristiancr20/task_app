import { describe, expect, it } from 'vitest'

import type { InboxStatus } from '@/lib/inbox'
import {
  nextReviewTitle,
  nextToReview,
  type ReviewNote,
  reviewPosition,
  reviewProgressLabel,
  reviewQueue,
} from '@/lib/inbox-review'

/** A row of the bandeja, reduced to what the round knows about it. */
function note(relPath: string, status: InboxStatus = 'extracted'): ReviewNote {
  return { relPath, title: `Acta ${relPath}`, status }
}

describe('reviewQueue', () => {
  it('keeps the notes with drafts, in the order given', () => {
    const items = [note('a.md'), note('b.md', 'untouched'), note('c.md')]
    expect(reviewQueue(items).map((item) => item.relPath)).toEqual(['a.md', 'c.md'])
  })

  it('is empty when nothing has been extracted', () => {
    expect(reviewQueue([note('a.md', 'untouched')])).toEqual([])
  })

  it('returns the same array when everything is pending review', () => {
    const items = [note('a.md'), note('b.md')]
    expect(reviewQueue(items)).toBe(items)
  })
})

describe('reviewPosition', () => {
  const queue = [note('a.md'), note('b.md'), note('c.md')]

  it('is 1-based, so the first note is «1 de 3»', () => {
    expect(reviewPosition(queue, 'a.md')).toBe(1)
    expect(reviewPosition(queue, 'c.md')).toBe(3)
  })

  it('is 0 for a note that is not in the round', () => {
    expect(reviewPosition(queue, 'otra.md')).toBe(0)
  })

  it('is 0 with no note open', () => {
    expect(reviewPosition(queue, null)).toBe(0)
  })

  it('is 0 over an empty round', () => {
    expect(reviewPosition([], 'a.md')).toBe(0)
  })
})

describe('nextToReview', () => {
  const queue = [note('a.md'), note('b.md'), note('c.md')]

  it('is the note after the one open', () => {
    expect(nextToReview(queue, 'a.md')?.relPath).toBe('b.md')
    expect(nextToReview(queue, 'b.md')?.relPath).toBe('c.md')
  })

  it('wraps, so a note skipped at the top is not stranded', () => {
    expect(nextToReview(queue, 'c.md')?.relPath).toBe('a.md')
  })

  it('starts at the top when nothing is open', () => {
    expect(nextToReview(queue, null)?.relPath).toBe('a.md')
  })

  it('starts at the top when the open note is not in the round', () => {
    // What a push leaves behind: the note that was just sent is out of the
    // inbox, and «siguiente» has to mean the first of what is left.
    expect(nextToReview(queue, 'ya-enviada.md')?.relPath).toBe('a.md')
  })

  it('is null when the round is empty', () => {
    expect(nextToReview([], 'a.md')).toBeNull()
    expect(nextToReview([], null)).toBeNull()
  })

  it('is null when the only note left is the one on screen', () => {
    expect(nextToReview([note('a.md')], 'a.md')).toBeNull()
  })

  it('is the other one when two are left', () => {
    const two = [note('a.md'), note('b.md')]
    expect(nextToReview(two, 'a.md')?.relPath).toBe('b.md')
    expect(nextToReview(two, 'b.md')?.relPath).toBe('a.md')
  })

  it('visits every note of the round before repeating', () => {
    const seen: string[] = []
    let current: string | null = null
    for (let step = 0; step < queue.length; step += 1) {
      const next: ReviewNote | null = nextToReview(queue, current)
      expect(next).not.toBeNull()
      current = next ? next.relPath : null
      if (current) seen.push(current)
    }
    expect(new Set(seen).size).toBe(queue.length)
  })

  it('hands back the row itself, so the caller has its title', () => {
    expect(nextToReview(queue, 'a.md')).toBe(queue[1])
  })
})

describe('reviewProgressLabel', () => {
  it('places the open note in the round', () => {
    expect(reviewProgressLabel(2, 5)).toBe('Nota 2 de 5 por revisar')
  })

  it('reports what is left when the open note is not one of them', () => {
    expect(reviewProgressLabel(0, 4)).toBe('Quedan 4 notas por revisar')
    expect(reviewProgressLabel(0, 1)).toBe('Queda 1 nota por revisar')
  })

  it('says the round is over when nothing is left', () => {
    expect(reviewProgressLabel(0, 0)).toBe('No queda nada por revisar')
    expect(reviewProgressLabel(1, 0)).toBe('No queda nada por revisar')
  })

  it('does not claim a position outside the round', () => {
    expect(reviewProgressLabel(7, 3)).toBe('Quedan 3 notas por revisar')
  })
})

describe('nextReviewTitle', () => {
  it('names the note it would open', () => {
    expect(nextReviewTitle(note('b.md'))).toBe('Abrir «Acta b.md»')
  })

  it('says why it refuses when there is nothing next', () => {
    expect(nextReviewTitle(null)).toContain('No queda')
  })
})
