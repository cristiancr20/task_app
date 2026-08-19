import { describe, expect, it } from 'vitest'

import { normalizeRelPath, titleFromFileName } from '@/lib/transcripts'

describe('titleFromFileName', () => {
  it('drops the .md extension', () => {
    expect(titleFromFileName('notes.md')).toBe('notes')
    expect(titleFromFileName('NOTES.MD')).toBe('NOTES')
  })

  it('drops a leading date and its separator', () => {
    expect(titleFromFileName('2026-08-09 Weekly sync.md')).toBe('Weekly sync')
    expect(titleFromFileName('2026-08-09_Weekly sync.md')).toBe('Weekly sync')
    expect(titleFromFileName('2026-08-09-Weekly sync.md')).toBe('Weekly sync')
  })

  it('turns underscores and dashes into single spaces', () => {
    expect(titleFromFileName('weekly-sync__notes.md')).toBe('weekly sync notes')
    expect(titleFromFileName('weekly   sync.md')).toBe('weekly sync')
  })

  it('keeps the stem when the date is all there is', () => {
    expect(titleFromFileName('2026-08-09.md')).toBe('2026 08 09')
  })
})

describe('normalizeRelPath', () => {
  it('treats the three spellings of the root as empty', () => {
    expect(normalizeRelPath('')).toBe('')
    expect(normalizeRelPath('.')).toBe('')
    expect(normalizeRelPath('/')).toBe('')
    expect(normalizeRelPath('   ')).toBe('')
  })

  it('reads an absolute-looking path as root-relative', () => {
    expect(normalizeRelPath('/sub/notes.md')).toBe('sub/notes.md')
    expect(normalizeRelPath('///sub/notes.md')).toBe('sub/notes.md')
  })

  it('normalizes backslashes to forward slashes', () => {
    expect(normalizeRelPath('sub\\notes.md')).toBe('sub/notes.md')
  })

  it('trims surrounding whitespace and trailing slashes', () => {
    expect(normalizeRelPath('  sub/nested  ')).toBe('sub/nested')
    expect(normalizeRelPath('sub/nested//')).toBe('sub/nested')
  })
})
