import { describe, expect, it } from 'vitest'

import { fileMatchesFilter, filterFiles, prepareFilter } from '@/lib/file-filter'

/** One row of a listing, reduced to the two strings the filter reads. */
function file(title: string, fileName = 'nota.md') {
  return { title, fileName }
}

const LISTING = [
  file('Reunión de diseño', 'reunion-diseno.md'),
  file('Retro de agosto', 'retro-agosto.md'),
  file('Cierre del trimestre', 'cierre-q3.md'),
]

describe('prepareFilter', () => {
  it('folds what was typed to lowercase without diacritics', () => {
    expect(prepareFilter('REUNIÓN')).toBe('reunion')
  })

  it('trims the edges but keeps the spaces inside', () => {
    expect(prepareFilter('  acta de cierre  ')).toBe('acta de cierre')
  })

  it('collapses a run of spaces, so a wrapped phrase still matches', () => {
    expect(prepareFilter('acta   de')).toBe('acta de')
  })

  it('is empty for a field holding nothing but whitespace', () => {
    expect(prepareFilter('   ')).toBe('')
  })

  it('is empty for an empty field', () => {
    expect(prepareFilter('')).toBe('')
  })

  it('keeps a single character, which a filter over a loaded list can use', () => {
    expect(prepareFilter('R')).toBe('r')
  })
})

describe('fileMatchesFilter', () => {
  it('matches a title regardless of case', () => {
    expect(fileMatchesFilter(file('Retro de agosto'), 'retro')).toBe(true)
  })

  it('matches a title whose accents the filter does not carry', () => {
    expect(fileMatchesFilter(file('Reunión de diseño'), 'reunion')).toBe(true)
  })

  it('matches an unaccented title from an accented filter', () => {
    expect(fileMatchesFilter(file('Reunion de equipo'), prepareFilter('reunión'))).toBe(true)
  })

  it('folds the tilde of «ñ» like any other mark', () => {
    expect(fileMatchesFilter(file('Plan de mañana'), 'manana')).toBe(true)
  })

  it('matches the file name when the title says nothing', () => {
    expect(fileMatchesFilter(file('Acta', 'retro-agosto.md'), 'retro')).toBe(true)
  })

  it('matches the extension of the file name, which is part of it', () => {
    expect(fileMatchesFilter(file('Acta', 'retro.md'), '.md')).toBe(true)
  })

  it('matches in the middle of a word, not only at its start', () => {
    expect(fileMatchesFilter(file('Presupuesto'), 'supue')).toBe(true)
  })

  it('does not match what is in neither the title nor the file name', () => {
    expect(fileMatchesFilter(file('Acta', 'acta.md'), 'retro')).toBe(false)
  })

  it('matches everything with an empty needle', () => {
    expect(fileMatchesFilter(file('Lo que sea'), '')).toBe(true)
  })
})

describe('filterFiles', () => {
  it('is inactive with an empty field and answers the whole listing', () => {
    const result = filterFiles(LISTING, '')

    expect(result.active).toBe(false)
    expect(result.query).toBe('')
    expect(result.files).toHaveLength(3)
    expect(result.total).toBe(3)
  })

  it('gives back the very same array when nothing is filtered', () => {
    expect(filterFiles(LISTING, '').files).toBe(LISTING)
  })

  it('is inactive for a field of spaces alone', () => {
    expect(filterFiles(LISTING, '   ').active).toBe(false)
    expect(filterFiles(LISTING, '   ').files).toBe(LISTING)
  })

  it('keeps only the rows that match, in the order they arrived', () => {
    const result = filterFiles(LISTING, 'e')

    expect(result.files.map((each) => each.title)).toEqual([
      'Reunión de diseño',
      'Retro de agosto',
      'Cierre del trimestre',
    ])
  })

  it('narrows to the row whose title matches, accents aside', () => {
    const result = filterFiles(LISTING, 'DISEÑO')

    expect(result.active).toBe(true)
    expect(result.files.map((each) => each.title)).toEqual(['Reunión de diseño'])
  })

  it('narrows to the row whose file name matches', () => {
    const result = filterFiles(LISTING, 'q3')

    expect(result.files.map((each) => each.title)).toEqual(['Cierre del trimestre'])
  })

  it('reports the folder size next to what is being shown', () => {
    const result = filterFiles(LISTING, 'retro')

    expect(result.files).toHaveLength(1)
    expect(result.total).toBe(3)
  })

  it('answers an empty list, still active, when nothing matches', () => {
    const result = filterFiles(LISTING, 'presupuesto')

    expect(result.active).toBe(true)
    expect(result.files).toEqual([])
    expect(result.total).toBe(3)
  })

  it('answers the folded needle, which is what it matched with', () => {
    expect(filterFiles(LISTING, '  Retró ').query).toBe('retro')
  })

  it('handles an empty folder without pretending it is filtered', () => {
    const result = filterFiles([], 'retro')

    expect(result.files).toEqual([])
    expect(result.total).toBe(0)
  })

  it('leaves the rows it keeps untouched', () => {
    const result = filterFiles(LISTING, 'retro')

    expect(result.files[0]).toBe(LISTING[1])
  })
})
