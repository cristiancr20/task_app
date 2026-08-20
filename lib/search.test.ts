import { describe, expect, it } from 'vitest'

import {
  findMatches,
  MAX_MATCHES_PER_FILE,
  MIN_QUERY_LENGTH,
  prepareQuery,
  searchNote,
  sortResults,
  SNIPPET_CONTEXT_CHARS,
  type SearchNote,
  type SearchResult,
} from '@/lib/search'

/** The note every test searches, unless it needs a different title or date. */
function note(overrides: Partial<SearchNote> = {}): SearchNote {
  return {
    relPath: '2026-08-09 Weekly sync.md',
    fileName: '2026-08-09 Weekly sync.md',
    title: 'Weekly sync',
    date: '2026-08-09',
    ...overrides,
  }
}

/** A result built by hand, for the sorting tests. */
function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return { ...note(), matchCount: 1, matches: [], ...overrides }
}

/** The query as `searchNote` wants it: normalised, and known to be long enough. */
function query(raw: string): string {
  const prepared = prepareQuery(raw)
  if (!prepared.ok) throw new Error(`La consulta «${raw}» es demasiado corta`)
  return prepared.query
}

/** What the UI would render highlighted: the excerpt sliced by its offsets. */
function highlighted(match: { text: string; start: number; end: number }): string {
  return match.text.slice(match.start, match.end)
}

describe('prepareQuery', () => {
  it('normalises to lowercase without accents', () => {
    expect(prepareQuery('  MIGRACIÓN  ')).toEqual({ ok: true, query: 'migracion' })
  })

  it('collapses the whitespace inside the query', () => {
    expect(prepareQuery('endpoint   de\n  pagos')).toEqual({
      ok: true,
      query: 'endpoint de pagos',
    })
  })

  it('refuses a query shorter than the minimum', () => {
    expect(prepareQuery('a')).toEqual({ ok: false, reason: 'too-short' })
    expect(prepareQuery('')).toEqual({ ok: false, reason: 'too-short' })
    expect(prepareQuery('   ')).toEqual({ ok: false, reason: 'too-short' })
    expect(MIN_QUERY_LENGTH).toBe(2)
  })

  it('measures the length after normalising, so one accented letter is one', () => {
    expect(prepareQuery('é')).toEqual({ ok: false, reason: 'too-short' })
    expect(prepareQuery('  ó ')).toEqual({ ok: false, reason: 'too-short' })
  })

  it('accepts a query of exactly the minimum length', () => {
    expect(prepareQuery('QA')).toEqual({ ok: true, query: 'qa' })
  })
})

describe('searchNote', () => {
  it('finds the phrase exactly as it was written', () => {
    const found = searchNote(query('presupuesto'), note(), 'Falta cerrar el presupuesto del Q3.')

    expect(found).not.toBeNull()
    expect(found!.matchCount).toBe(1)
    expect(found!.matches).toHaveLength(1)
    expect(found!.matches[0].field).toBe('body')
    expect(highlighted(found!.matches[0])).toBe('presupuesto')
  })

  it('returns null when the phrase is not in the note', () => {
    expect(searchNote(query('presupuesto'), note(), 'Falta cerrar el trimestre.')).toBeNull()
  })

  it('matches without distinguishing accents, in either direction', () => {
    const written = searchNote(query('migracion'), note(), 'Hablamos de la migración del API.')
    expect(highlighted(written!.matches[0])).toBe('migración')

    const typed = searchNote(query('MIGRACIÓN'), note(), 'Hablamos de la migracion del API.')
    expect(highlighted(typed!.matches[0])).toBe('migracion')
  })

  it('matches a note whose accent was typed as a combining mark', () => {
    // What a Mac dead key produces: «o» followed by U+0301, not «\u00f3».
    const found = searchNote(query('migracion'), note(), 'La migracio\u0301n del API')

    expect(found!.matchCount).toBe(1)
    // The mark is inside the highlight, not left dangling after it.
    expect(highlighted(found!.matches[0])).toBe('migracio\u0301n')
  })

  it('folds a letter whose lowercase carries its own mark', () => {
    // «\u0130» only reduces to «i» when the mark is dropped before lowercasing.
    const found = searchNote(query('istanbul'), note(), 'Vamos a \u0130stanbul')

    expect(highlighted(found!.matches[0])).toBe('\u0130stanbul')
  })

  it('matches without distinguishing case', () => {
    const found = searchNote(query('linear'), note(), 'Todo lo pasamos a LINEAR y a Linear Docs.')

    expect(found!.matchCount).toBe(2)
    expect(highlighted(found!.matches[0])).toBe('LINEAR')
    expect(highlighted(found!.matches[1])).toBe('Linear')
  })

  it('matches a phrase that the note wrapped across two lines', () => {
    const found = searchNote(query('endpoint de pagos'), note(), 'Migrar el endpoint\nde pagos ya.')

    expect(found!.matchCount).toBe(1)
    // The line break is inside the highlight, collapsed to a single space.
    expect(highlighted(found!.matches[0])).toBe('endpoint de pagos')
  })

  it('searches the title as well as the body', () => {
    const found = searchNote(query('retro'), note({ title: 'Retro del sprint 12' }), 'Sin novedades.')

    expect(found!.matchCount).toBe(1)
    expect(found!.matches[0].field).toBe('title')
    expect(found!.matches[0].text).toBe('Retro del sprint 12')
    expect(highlighted(found!.matches[0])).toBe('Retro')
  })

  it('puts the title match before the body ones and counts both', () => {
    const found = searchNote(
      query('retro'),
      note({ title: 'Retro del sprint' }),
      'La retro fue larga. Cerramos la retro con dos acuerdos.',
    )

    expect(found!.matchCount).toBe(3)
    expect(found!.matches.map((match) => match.field)).toEqual(['title', 'body', 'body'])
  })

  it('returns several matches from one file, capped by the constant', () => {
    const body = Array.from({ length: 12 }, (_, i) => `Punto ${i}: hablamos de pagos.`).join('\n')
    const found = searchNote(query('pagos'), note(), body)

    // Every occurrence is counted; only the first few carry an excerpt.
    expect(found!.matchCount).toBe(12)
    expect(found!.matches).toHaveLength(MAX_MATCHES_PER_FILE)
    expect(MAX_MATCHES_PER_FILE).toBeLessThan(12)
  })

  it('lets a caller narrow the cap without touching the count', () => {
    const found = searchNote(query('pagos'), note(), 'pagos, pagos y más pagos', { maxMatches: 1 })

    expect(found!.matchCount).toBe(3)
    expect(found!.matches).toHaveLength(1)
  })

  it('carries the note metadata through, and nothing else', () => {
    const found = searchNote(query('pagos'), note(), 'Sobre pagos.')

    expect(Object.keys(found!).sort()).toEqual(
      ['date', 'fileName', 'matchCount', 'matches', 'relPath', 'title'].sort(),
    )
    expect(found!.relPath).toBe('2026-08-09 Weekly sync.md')
    expect(found!.date).toBe('2026-08-09')
  })
})

describe('findMatches', () => {
  it('surrounds the match with the text before and after it', () => {
    const body = `${'ruido '.repeat(40)}la palabra clave ${'ruido '.repeat(40)}`
    const [match] = findMatches(query('palabra clave'), body, 'body').matches

    expect(highlighted(match)).toBe('palabra clave')
    expect(match.text.slice(0, match.start)).toMatch(/ruido la $/)
    expect(match.text.slice(match.end)).toMatch(/^ ruido/)
    // Bounded on both sides by the context window, plus the match itself.
    expect(match.text.length).toBeLessThanOrEqual(
      'palabra clave'.length + 2 * SNIPPET_CONTEXT_CHARS,
    )
  })

  it('never inserts markup: the excerpt is the note text, offsets aside', () => {
    const { matches } = findMatches(query('script'), 'Un <script> en la nota', 'body')

    expect(matches[0].text).toBe('Un <script> en la nota')
    expect(highlighted(matches[0])).toBe('script')
  })

  it('starts the excerpt at the beginning when the match is at the edge', () => {
    const body = `Presupuesto aprobado. ${'ruido '.repeat(40)}`
    const [match] = findMatches(query('presupuesto'), body, 'body').matches

    expect(match.start).toBe(0)
    expect(match.text.startsWith('Presupuesto aprobado.')).toBe(true)
  })

  it('ends the excerpt at the end when the match is the last thing said', () => {
    const body = `${'ruido '.repeat(40)}y aprobamos el presupuesto`
    const [match] = findMatches(query('presupuesto'), body, 'body').matches

    expect(match.end).toBe(match.text.length)
    expect(match.text.endsWith('y aprobamos el presupuesto')).toBe(true)
  })

  it('handles a note that is nothing but the match', () => {
    const [match] = findMatches(query('pagos'), 'pagos', 'body').matches

    expect(match).toEqual({ field: 'body', text: 'pagos', start: 0, end: 5 })
  })

  it('collapses the whitespace of the excerpt without moving the highlight', () => {
    const [match] = findMatches(query('acuerdo'), 'Un\n\n  acuerdo   \n  claro', 'body').matches

    expect(match.text).toBe('Un acuerdo claro')
    expect(highlighted(match)).toBe('acuerdo')
  })

  it('does not count overlapping occurrences twice', () => {
    expect(findMatches(query('aa'), 'aaa', 'body').count).toBe(1)
    expect(findMatches(query('aa'), 'aaaa', 'body').count).toBe(2)
  })

  it('counts every occurrence even when no excerpt is asked for', () => {
    const found = findMatches(query('pagos'), 'pagos y pagos', 'body', { maxMatches: 0 })

    expect(found).toEqual({ count: 2, matches: [] })
  })

  it('finds nothing in an empty text, and nothing for an empty query', () => {
    expect(findMatches(query('pagos'), '', 'body')).toEqual({ count: 0, matches: [] })
    expect(findMatches('', 'pagos y pagos', 'body')).toEqual({ count: 0, matches: [] })
  })
})

describe('sortResults', () => {
  it('orders by number of matches, descending', () => {
    const sorted = sortResults([
      result({ relPath: 'a.md', matchCount: 1 }),
      result({ relPath: 'b.md', matchCount: 7 }),
      result({ relPath: 'c.md', matchCount: 3 }),
    ])

    expect(sorted.map((it) => it.relPath)).toEqual(['b.md', 'c.md', 'a.md'])
  })

  it('breaks a tie by date, most recent first', () => {
    const sorted = sortResults([
      result({ relPath: 'old.md', matchCount: 2, date: '2026-01-05' }),
      result({ relPath: 'new.md', matchCount: 2, date: '2026-08-09' }),
    ])

    expect(sorted.map((it) => it.relPath)).toEqual(['new.md', 'old.md'])
  })

  it('sends undated notes to the end of their tie', () => {
    const sorted = sortResults([
      result({ relPath: 'none.md', matchCount: 2, date: null }),
      result({ relPath: 'dated.md', matchCount: 2, date: '2020-01-01' }),
    ])

    expect(sorted.map((it) => it.relPath)).toEqual(['dated.md', 'none.md'])
  })

  it('ranks a busier note above a more recent one', () => {
    const sorted = sortResults([
      result({ relPath: 'recent.md', matchCount: 1, date: '2026-08-09' }),
      result({ relPath: 'busy.md', matchCount: 5, date: '2020-01-01' }),
    ])

    expect(sorted.map((it) => it.relPath)).toEqual(['busy.md', 'recent.md'])
  })

  it('breaks a full tie by title, so the order does not depend on the walk', () => {
    const sorted = sortResults([
      result({ relPath: 'b.md', title: 'Retro' }),
      result({ relPath: 'a.md', title: 'Daily' }),
    ])

    expect(sorted.map((it) => it.title)).toEqual(['Daily', 'Retro'])
  })

  it('does not touch the array it was given', () => {
    const results = [result({ matchCount: 1 }), result({ matchCount: 9 })]
    sortResults(results)

    expect(results.map((it) => it.matchCount)).toEqual([1, 9])
  })
})
