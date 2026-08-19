import { describe, expect, it } from 'vitest'

import { createDraftIds } from '@/lib/draft-ids'

describe('createDraftIds', () => {
  it('hands out row keys in order', () => {
    const ids = createDraftIds()

    expect(ids.next()).toBe('row-1')
    expect(ids.next()).toBe('row-2')
    expect(ids.next()).toBe('row-3')
  })

  it('gives every generator its own counter', () => {
    const one = createDraftIds()
    const other = createDraftIds()

    one.next()
    one.next()

    expect(other.next()).toBe('row-1')
  })
})

describe('reserve', () => {
  it('moves the counter past a restored key', () => {
    const ids = createDraftIds()

    ids.reserve(['row-4'])

    expect(ids.next()).toBe('row-5')
  })

  it('moves it past the highest of them, whatever the order', () => {
    const ids = createDraftIds()

    ids.reserve(['row-9', 'row-2', 'row-7'])

    expect(ids.next()).toBe('row-10')
  })

  // The whole point: a page that restored `row-1` from disk and then adds a row
  // must not put a second `row-1` on screen — same React key, and an edit or a
  // «Eliminar» aimed at one of them landing on both.
  it('never repeats a restored key', () => {
    const ids = createDraftIds()
    const restored = ['row-1', 'row-2', 'row-3']

    ids.reserve(restored)
    const minted = [ids.next(), ids.next(), ids.next()]

    expect(new Set([...restored, ...minted]).size).toBe(6)
  })

  it('never repeats a key it already handed out', () => {
    const ids = createDraftIds()
    const first = ids.next()

    // The drafts of an older, lower-numbered note coming back from disk.
    ids.reserve(['row-1'])

    expect(ids.next()).not.toBe(first)
  })

  it('does not rewind for a key below the counter', () => {
    const ids = createDraftIds()
    ids.next()
    ids.next()

    ids.reserve(['row-1'])

    expect(ids.next()).toBe('row-3')
  })

  it('leaves the counter alone when a key is reserved twice', () => {
    const ids = createDraftIds()

    ids.reserve(['row-5'])
    ids.reserve(['row-5'])

    expect(ids.next()).toBe('row-6')
  })

  it('accepts nothing at all', () => {
    const ids = createDraftIds()

    ids.reserve([])

    expect(ids.next()).toBe('row-1')
  })

  // Ids stay opaque on the wire: one this module did not mint restores under
  // its own name rather than being renamed, so it cannot move the counter.
  it.each([
    ['a uuid', '3f1b0a9c-0000-4000-8000-000000000000'],
    ['a bare prefix', 'row-'],
    ['a suffixed number', 'row-1a'],
    ['a different prefix', 'draft-9'],
    ['a negative number', 'row--3'],
    ['a decimal', 'row-1.5'],
    ['the empty string', ''],
  ])('ignores %s', (_label, id) => {
    const ids = createDraftIds()

    ids.reserve([id])

    expect(ids.next()).toBe('row-1')
  })

  it('ignores a number past the safe integer range', () => {
    const ids = createDraftIds()

    // Reserving it would leave the counter somewhere it can no longer be
    // incremented, and every later key would be the same string.
    ids.reserve([`row-${Number.MAX_SAFE_INTEGER + 10}`])

    expect(ids.next()).toBe('row-1')
  })

  it('takes the recognised keys out of a mixed list', () => {
    const ids = createDraftIds()

    ids.reserve(['imported-1', 'row-6', 'row-x'])

    expect(ids.next()).toBe('row-7')
  })

  it('reads leading zeroes as the number they are', () => {
    const ids = createDraftIds()

    ids.reserve(['row-007'])

    expect(ids.next()).toBe('row-8')
  })
})
