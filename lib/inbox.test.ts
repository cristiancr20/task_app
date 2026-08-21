import { describe, expect, it } from 'vitest'

import {
  buildInbox,
  byDateDescThenTitle,
  type InboxItem,
  inboxCounts,
  noteSizeLabel,
} from '@/lib/inbox'
import type { TranscriptMeta } from '@/lib/transcripts'

function meta(partial: Partial<TranscriptMeta> = {}): TranscriptMeta {
  return {
    relPath: '2026/agosto/reunion.md',
    fileName: 'reunion.md',
    title: 'Reunión de agosto',
    date: '2026-08-12',
    attendees: [],
    words: 420,
    approxTokens: 560,
    hasFrontmatter: true,
    ...partial,
  }
}

/** An inbox row, for the sort and the counts, which do not need a walk. */
function item(partial: Partial<InboxItem> = {}): InboxItem {
  return {
    relPath: 'reunion.md',
    fileName: 'reunion.md',
    title: 'Reunión',
    date: '2026-08-12',
    folder: '',
    words: 420,
    approxTokens: 560,
    status: 'untouched',
    ...partial,
  }
}

describe('buildInbox', () => {
  it('keeps a note nobody has touched, as untouched', () => {
    expect(buildInbox({ files: [meta()], pushed: [], drafted: [] })).toEqual([
      {
        relPath: '2026/agosto/reunion.md',
        fileName: 'reunion.md',
        title: 'Reunión de agosto',
        date: '2026-08-12',
        folder: '2026/agosto',
        words: 420,
        approxTokens: 560,
        status: 'untouched',
      },
    ])
  })

  it('drops a note that has been pushed', () => {
    const files = [meta({ relPath: 'a.md' }), meta({ relPath: 'b.md' })]
    const inbox = buildInbox({ files, pushed: ['a.md'], drafted: [] })

    expect(inbox.map((row) => row.relPath)).toEqual(['b.md'])
  })

  it('keeps a note with drafts, and marks it as extracted', () => {
    const inbox = buildInbox({ files: [meta({ relPath: 'a.md' })], pushed: [], drafted: ['a.md'] })

    expect(inbox).toHaveLength(1)
    expect(inbox[0].status).toBe('extracted')
  })

  it('lets the push win over the drafts: a pushed note is out even with drafts', () => {
    const inbox = buildInbox({
      files: [meta({ relPath: 'a.md' })],
      pushed: ['a.md'],
      drafted: ['a.md'],
    })

    expect(inbox).toEqual([])
  })

  it('is empty when every note has been pushed', () => {
    const files = [meta({ relPath: 'a.md' }), meta({ relPath: 'b.md' })]

    expect(buildInbox({ files, pushed: ['a.md', 'b.md'], drafted: [] })).toEqual([])
  })

  it('is empty when the walk found nothing', () => {
    expect(buildInbox({ files: [], pushed: ['a.md'], drafted: ['b.md'] })).toEqual([])
  })

  it('ignores pushed and drafted paths that name no note on disk', () => {
    const inbox = buildInbox({
      files: [meta({ relPath: 'a.md' })],
      pushed: ['borrada.md'],
      drafted: ['tampoco.md'],
    })

    expect(inbox.map((row) => row.relPath)).toEqual(['a.md'])
  })

  it('accepts sets as well as arrays', () => {
    const inbox = buildInbox({
      files: [meta({ relPath: 'a.md' }), meta({ relPath: 'b.md' })],
      pushed: new Set(['a.md']),
      drafted: new Set(['b.md']),
    })

    expect(inbox.map((row) => [row.relPath, row.status])).toEqual([['b.md', 'extracted']])
  })

  it('reads the folder off the path, and leaves a note at the root without one', () => {
    const inbox = buildInbox({
      files: [meta({ relPath: 'raiz.md' }), meta({ relPath: '2026/agosto/nota.md' })],
      pushed: [],
      drafted: [],
    })
    const folders = Object.fromEntries(inbox.map((row) => [row.relPath, row.folder]))

    expect(folders).toEqual({ 'raiz.md': '', '2026/agosto/nota.md': '2026/agosto' })
  })

  it('orders by date descending whatever order the walk produced', () => {
    const files = [
      meta({ relPath: 'vieja.md', date: '2026-01-02', title: 'Vieja' }),
      meta({ relPath: 'nueva.md', date: '2026-08-30', title: 'Nueva' }),
      meta({ relPath: 'media.md', date: '2026-05-05', title: 'Media' }),
    ]
    const inbox = buildInbox({ files, pushed: [], drafted: [] })

    expect(inbox.map((row) => row.relPath)).toEqual(['nueva.md', 'media.md', 'vieja.md'])
  })

  it('puts the undated notes last, however old the dated ones are', () => {
    const files = [
      meta({ relPath: 'sin-fecha.md', date: null, title: 'Sin fecha' }),
      meta({ relPath: 'antigua.md', date: '1999-01-01', title: 'Antigua' }),
    ]
    const inbox = buildInbox({ files, pushed: [], drafted: [] })

    expect(inbox.map((row) => row.relPath)).toEqual(['antigua.md', 'sin-fecha.md'])
  })

  it('does not mutate the array it was given', () => {
    const files = [
      meta({ relPath: 'vieja.md', date: '2026-01-02' }),
      meta({ relPath: 'nueva.md', date: '2026-08-30' }),
    ]
    buildInbox({ files, pushed: [], drafted: [] })

    expect(files.map((file) => file.relPath)).toEqual(['vieja.md', 'nueva.md'])
  })
})

describe('byDateDescThenTitle', () => {
  it('sorts the more recent date first', () => {
    expect(
      byDateDescThenTitle(item({ date: '2026-01-01' }), item({ date: '2026-08-01' })),
    ).toBeGreaterThan(0)
  })

  it('sends an undated note after a dated one, whichever side it is on', () => {
    expect(byDateDescThenTitle(item({ date: null }), item({ date: '2026-08-01' }))).toBe(1)
    expect(byDateDescThenTitle(item({ date: '2026-08-01' }), item({ date: null }))).toBe(-1)
  })

  it('falls back to the title when the dates are the same', () => {
    expect(byDateDescThenTitle(item({ title: 'Ana' }), item({ title: 'Zoe' }))).toBeLessThan(0)
  })

  it('falls back to the title when neither has a date', () => {
    const a = item({ date: null, title: 'Ana' })
    const z = item({ date: null, title: 'Zoe' })

    expect(byDateDescThenTitle(a, z)).toBeLessThan(0)
    expect(byDateDescThenTitle(z, a)).toBeGreaterThan(0)
  })

  it('is zero for two rows that are the same note', () => {
    expect(byDateDescThenTitle(item(), item())).toBe(0)
  })
})

describe('inboxCounts', () => {
  it('counts nothing over an empty inbox', () => {
    expect(inboxCounts([])).toEqual({ total: 0, untouched: 0, extracted: 0 })
  })

  it('splits the pending notes into touched and untouched', () => {
    const items = [
      item({ relPath: 'a.md', status: 'untouched' }),
      item({ relPath: 'b.md', status: 'extracted' }),
      item({ relPath: 'c.md', status: 'extracted' }),
    ]

    expect(inboxCounts(items)).toEqual({ total: 3, untouched: 1, extracted: 2 })
  })
})

describe('noteSizeLabel', () => {
  it('writes a small note out exactly', () => {
    expect(noteSizeLabel(840)).toBe('840 palabras')
  })

  it('says a single word in the singular', () => {
    expect(noteSizeLabel(1)).toBe('1 palabra')
  })

  it('abbreviates a thousand words with one decimal', () => {
    expect(noteSizeLabel(1200)).toBe('1,2k palabras')
  })

  it('drops the decimal above ten thousand', () => {
    expect(noteSizeLabel(18_400)).toBe('18k palabras')
  })

  it('says «sin texto» rather than «0 palabras»', () => {
    expect(noteSizeLabel(0)).toBe('sin texto')
    expect(noteSizeLabel(-3)).toBe('sin texto')
  })

  it('says «sin texto» for a number that is not one', () => {
    expect(noteSizeLabel(Number.NaN)).toBe('sin texto')
    expect(noteSizeLabel(Number.POSITIVE_INFINITY)).toBe('sin texto')
  })
})
