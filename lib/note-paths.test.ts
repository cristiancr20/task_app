import { describe, expect, it } from 'vitest'

import { ancestorFolders, folderLabel, folderName, folderOfNote } from '@/lib/note-paths'

describe('folderOfNote', () => {
  it('is the root for a note with no folder in its path', () => {
    expect(folderOfNote('reunion.md')).toBe('')
  })

  it('is everything before the last separator', () => {
    expect(folderOfNote('2026/agosto/reunion.md')).toBe('2026/agosto')
  })

  it('keeps the folder of a name that itself contains dots', () => {
    expect(folderOfNote('notas/v1.2/acta.md')).toBe('notas/v1.2')
  })

  it('is the root for an empty path', () => {
    expect(folderOfNote('')).toBe('')
  })
})

describe('ancestorFolders', () => {
  it('is the root alone for the root', () => {
    expect(ancestorFolders('')).toEqual([''])
  })

  it('walks from the root down to the folder itself', () => {
    expect(ancestorFolders('2026/agosto/semana-3')).toEqual([
      '',
      '2026',
      '2026/agosto',
      '2026/agosto/semana-3',
    ])
  })

  it('ends on the folder it was asked about', () => {
    const chain = ancestorFolders('a/b')
    expect(chain[chain.length - 1]).toBe('a/b')
  })

  it('never builds a path out of an empty segment', () => {
    expect(ancestorFolders('a//b')).toEqual(['', 'a', 'a/b'])
  })
})

describe('folderLabel', () => {
  it('is the root name alone for the root', () => {
    expect(folderLabel('contexto', '')).toBe('contexto')
  })

  it('puts the root name at the head of the folder path', () => {
    expect(folderLabel('contexto', '2026/agosto')).toBe('contexto / 2026 / agosto')
  })
})

describe('folderName', () => {
  it('is the last segment of an absolute path', () => {
    expect(folderName('/Users/ana/notas/contexto')).toBe('contexto')
  })

  it('ignores a trailing separator', () => {
    expect(folderName('/Users/ana/notas/contexto/')).toBe('contexto')
  })

  it('understands a windows path', () => {
    expect(folderName('C:\\Users\\ana\\contexto')).toBe('contexto')
  })

  it('falls back to the path itself when there is no segment to take', () => {
    expect(folderName('/')).toBe('/')
  })
})
