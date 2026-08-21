import { describe, expect, it } from 'vitest'

import type { InboxCounts, InboxStatus } from '@/lib/inbox'
import {
  DEFAULT_INBOX_SCOPE,
  INBOX_SCOPES,
  type InboxScope,
  scopeCount,
  scopeEmptyLabel,
  scopeItems,
  scopeLabel,
  scopeTitle,
} from '@/lib/inbox-scope'

/** Rows, reduced to what a scope knows about them. */
function rows(...statuses: InboxStatus[]): { relPath: string; status: InboxStatus }[] {
  return statuses.map((status, index) => ({ relPath: `nota-${index}.md`, status }))
}

const COUNTS: InboxCounts = { total: 12, untouched: 9, extracted: 3 }

describe('INBOX_SCOPES', () => {
  it('is the whole first, then each half', () => {
    expect(INBOX_SCOPES).toEqual(['all', 'untouched', 'extracted'])
  })

  it('opens on «todas»', () => {
    expect(DEFAULT_INBOX_SCOPE).toBe('all')
  })
})

describe('scopeItems', () => {
  it('returns the very same array for «todas»', () => {
    const items = rows('untouched', 'extracted')
    expect(scopeItems(items, 'all')).toBe(items)
  })

  it('keeps only the notes with drafts for «por revisar»', () => {
    const items = rows('untouched', 'extracted', 'untouched', 'extracted')
    expect(scopeItems(items, 'extracted').map((item) => item.relPath)).toEqual([
      'nota-1.md',
      'nota-3.md',
    ])
  })

  it('keeps only the notes without drafts for «sin tocar»', () => {
    const items = rows('untouched', 'extracted', 'untouched')
    expect(scopeItems(items, 'untouched').map((item) => item.relPath)).toEqual([
      'nota-0.md',
      'nota-2.md',
    ])
  })

  it('preserves the order it was given', () => {
    const items = rows('extracted', 'untouched', 'extracted', 'extracted')
    expect(scopeItems(items, 'extracted').map((item) => item.relPath)).toEqual([
      'nota-0.md',
      'nota-2.md',
      'nota-3.md',
    ])
  })

  it('returns the same array when every row already qualifies', () => {
    const items = rows('extracted', 'extracted')
    expect(scopeItems(items, 'extracted')).toBe(items)
  })

  it('answers an empty list for a scope nothing is in', () => {
    const items = rows('untouched', 'untouched')
    expect(scopeItems(items, 'extracted')).toEqual([])
  })

  it('does not touch the array it was given', () => {
    const items = rows('untouched', 'extracted')
    scopeItems(items, 'extracted')
    expect(items).toHaveLength(2)
  })

  it('answers an empty list for every scope over no rows', () => {
    for (const scope of INBOX_SCOPES) expect(scopeItems([], scope)).toEqual([])
  })
})

describe('scopeCount', () => {
  it('reads each scope out of the counts', () => {
    expect(scopeCount(COUNTS, 'all')).toBe(12)
    expect(scopeCount(COUNTS, 'untouched')).toBe(9)
    expect(scopeCount(COUNTS, 'extracted')).toBe(3)
  })

  it('adds up: the two halves are the whole', () => {
    expect(scopeCount(COUNTS, 'untouched') + scopeCount(COUNTS, 'extracted')).toBe(
      scopeCount(COUNTS, 'all'),
    )
  })

  it('agrees with what the rows themselves say', () => {
    const items = rows('untouched', 'extracted', 'untouched')
    const counts: InboxCounts = { total: 3, untouched: 2, extracted: 1 }
    for (const scope of INBOX_SCOPES) {
      expect(scopeItems(items, scope)).toHaveLength(scopeCount(counts, scope))
    }
  })
})

describe('scopeLabel / scopeTitle / scopeEmptyLabel', () => {
  it('names «por revisar» as what it is: extracted and unsent', () => {
    expect(scopeLabel('extracted')).toBe('Por revisar')
    expect(scopeTitle('extracted')).toContain('sin enviar')
  })

  it('gives every scope a label, a title and an empty message', () => {
    for (const scope of INBOX_SCOPES) {
      expect(scopeLabel(scope)).not.toBe('')
      expect(scopeTitle(scope)).not.toBe('')
      expect(scopeEmptyLabel(scope)).not.toBe('')
    }
  })

  it('says where the notes are when a scope is empty', () => {
    expect(scopeEmptyLabel('untouched')).toContain('borrador')
    expect(scopeEmptyLabel('extracted')).toContain('extrae')
  })

  it('has one label per scope', () => {
    const labels = new Set(INBOX_SCOPES.map((scope: InboxScope) => scopeLabel(scope)))
    expect(labels.size).toBe(INBOX_SCOPES.length)
  })
})
