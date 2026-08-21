import { describe, expect, it } from 'vitest'

import {
  deselectVisible,
  EMPTY_SELECTION,
  MAX_BATCH_SELECTION,
  pruneSelection,
  type Selection,
  selectedItems,
  selectionCountLabel,
  selectionLimitLabel,
  selectionSummary,
  selectVisible,
  toggleSelected,
} from '@/lib/inbox-selection'

/** Rows, reduced to the only thing a selection knows about them. */
function rows(...relPaths: string[]): { relPath: string }[] {
  return relPaths.map((relPath) => ({ relPath }))
}

function selection(...relPaths: string[]): Selection {
  return new Set(relPaths)
}

/** `n` rows named `nota-0.md`, `nota-1.md`… for the limit cases. */
function manyRows(n: number): { relPath: string }[] {
  return Array.from({ length: n }, (_, index) => ({ relPath: `nota-${index}.md` }))
}

describe('EMPTY_SELECTION', () => {
  it('is empty', () => {
    expect(EMPTY_SELECTION.size).toBe(0)
  })
})

describe('toggleSelected', () => {
  it('adds a row that was not chosen', () => {
    const next = toggleSelected(EMPTY_SELECTION, 'a.md')
    expect([...next]).toEqual(['a.md'])
  })

  it('removes a row that was chosen', () => {
    const next = toggleSelected(selection('a.md', 'b.md'), 'a.md')
    expect([...next]).toEqual(['b.md'])
  })

  it('does not touch the set it was given', () => {
    const before = selection('a.md')
    toggleSelected(before, 'b.md')
    expect([...before]).toEqual(['a.md'])
  })

  it('refuses to add past the limit, returning the same set', () => {
    const full = selection('a.md', 'b.md')
    const next = toggleSelected(full, 'c.md', 2)
    expect(next).toBe(full)
  })

  it('still removes when the tanda is full: it is the way out', () => {
    const full = selection('a.md', 'b.md')
    const next = toggleSelected(full, 'b.md', 2)
    expect([...next]).toEqual(['a.md'])
  })

  it('defaults to MAX_BATCH_SELECTION', () => {
    const full = new Set(manyRows(MAX_BATCH_SELECTION).map((row) => row.relPath))
    expect(toggleSelected(full, 'otra.md')).toBe(full)
  })
})

describe('selectVisible', () => {
  it('adds every visible row', () => {
    const next = selectVisible(EMPTY_SELECTION, rows('a.md', 'b.md', 'c.md'))
    expect([...next].sort()).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('keeps what was already chosen outside the visible rows', () => {
    const next = selectVisible(selection('oculta.md'), rows('a.md'))
    expect([...next].sort()).toEqual(['a.md', 'oculta.md'])
  })

  it('only reaches the visible rows: what the filter hides stays out', () => {
    // The whole list is three notes; the filter left one on screen.
    const next = selectVisible(EMPTY_SELECTION, rows('b.md'))
    expect([...next]).toEqual(['b.md'])
  })

  it('fills up to the limit instead of refusing the whole gesture', () => {
    const next = selectVisible(EMPTY_SELECTION, rows('a.md', 'b.md', 'c.md'), 2)
    expect([...next]).toEqual(['a.md', 'b.md'])
  })

  it('takes the rows in the order given, so the top of the list gets in', () => {
    const next = selectVisible(EMPTY_SELECTION, rows('primera.md', 'segunda.md'), 1)
    expect([...next]).toEqual(['primera.md'])
  })

  it('counts what was already chosen against the limit', () => {
    const next = selectVisible(selection('ya.md'), rows('a.md', 'b.md'), 2)
    expect([...next].sort()).toEqual(['a.md', 'ya.md'])
  })

  it('returns the same set when everything visible was already chosen', () => {
    const before = selection('a.md', 'b.md')
    expect(selectVisible(before, rows('a.md', 'b.md'))).toBe(before)
  })

  it('returns the same set when there is nothing visible', () => {
    const before = selection('a.md')
    expect(selectVisible(before, [])).toBe(before)
  })
})

describe('deselectVisible', () => {
  it('unticks the visible rows', () => {
    const next = deselectVisible(selection('a.md', 'b.md'), rows('a.md', 'b.md'))
    expect(next.size).toBe(0)
  })

  it('leaves what the filter is hiding alone', () => {
    const next = deselectVisible(selection('a.md', 'oculta.md'), rows('a.md'))
    expect([...next]).toEqual(['oculta.md'])
  })

  it('returns the same set when nothing visible was chosen', () => {
    const before = selection('oculta.md')
    expect(deselectVisible(before, rows('a.md'))).toBe(before)
  })

  it('returns the same set when nothing was chosen at all', () => {
    expect(deselectVisible(EMPTY_SELECTION, rows('a.md'))).toBe(EMPTY_SELECTION)
  })
})

describe('pruneSelection', () => {
  it('drops a note that is no longer in the list', () => {
    const next = pruneSelection(selection('a.md', 'enviada.md'), rows('a.md', 'b.md'))
    expect([...next]).toEqual(['a.md'])
  })

  it('returns the same set when everything chosen is still there', () => {
    const before = selection('a.md')
    expect(pruneSelection(before, rows('a.md', 'b.md'))).toBe(before)
  })

  it('returns the same set when nothing is chosen', () => {
    expect(pruneSelection(EMPTY_SELECTION, rows('a.md'))).toBe(EMPTY_SELECTION)
  })

  it('empties a selection when the list came back empty', () => {
    expect(pruneSelection(selection('a.md'), []).size).toBe(0)
  })

  it('prunes against the whole list, not against what the filter shows', () => {
    // Called with the full list on purpose: a filtered row is hidden, not gone.
    const next = pruneSelection(selection('a.md', 'b.md'), rows('a.md', 'b.md', 'c.md'))
    expect([...next].sort()).toEqual(['a.md', 'b.md'])
  })
})

describe('selectionSummary', () => {
  it('counts everything chosen, visible or not', () => {
    const summary = selectionSummary(selection('a.md', 'oculta.md'), rows('a.md'))
    expect(summary.count).toBe(2)
    expect(summary.visibleSelected).toBe(1)
  })

  it('says all visible are chosen when they are', () => {
    const summary = selectionSummary(selection('a.md', 'b.md'), rows('a.md', 'b.md'))
    expect(summary.allVisibleSelected).toBe(true)
    expect(summary.someVisibleSelected).toBe(false)
  })

  it('is «some» when only part of what is on screen is chosen', () => {
    const summary = selectionSummary(selection('a.md'), rows('a.md', 'b.md'))
    expect(summary.allVisibleSelected).toBe(false)
    expect(summary.someVisibleSelected).toBe(true)
  })

  it('a set full of hidden rows does not make the master box look ticked', () => {
    const summary = selectionSummary(selection('oculta.md'), rows('a.md'))
    expect(summary.allVisibleSelected).toBe(false)
    expect(summary.someVisibleSelected).toBe(false)
  })

  it('is not «todas» when nothing is visible', () => {
    const summary = selectionSummary(selection('oculta.md'), [])
    expect(summary.allVisibleSelected).toBe(false)
    expect(summary.someVisibleSelected).toBe(false)
    expect(summary.visible).toBe(0)
  })

  it('reports what is left of the tanda', () => {
    const summary = selectionSummary(selection('a.md', 'b.md'), rows('a.md'), 5)
    expect(summary.remaining).toBe(3)
    expect(summary.atLimit).toBe(false)
  })

  it('is at the limit when the tanda is full', () => {
    const summary = selectionSummary(selection('a.md', 'b.md'), rows('a.md'), 2)
    expect(summary.atLimit).toBe(true)
    expect(summary.remaining).toBe(0)
  })

  it('never reports a negative remainder', () => {
    const summary = selectionSummary(selection('a.md', 'b.md', 'c.md'), [], 2)
    expect(summary.remaining).toBe(0)
  })

  it('is empty and calm with nothing chosen', () => {
    const summary = selectionSummary(EMPTY_SELECTION, rows('a.md'))
    expect(summary).toMatchObject({
      count: 0,
      visibleSelected: 0,
      allVisibleSelected: false,
      someVisibleSelected: false,
      atLimit: false,
    })
  })

  it('a whole tanda of visible rows is at the limit and all ticked', () => {
    const visible = manyRows(MAX_BATCH_SELECTION)
    const summary = selectionSummary(selectVisible(EMPTY_SELECTION, visible), visible)
    expect(summary.count).toBe(MAX_BATCH_SELECTION)
    expect(summary.atLimit).toBe(true)
    expect(summary.allVisibleSelected).toBe(true)
  })

  it('«seleccionar todo» over more rows than fit leaves the rest unticked', () => {
    const visible = manyRows(MAX_BATCH_SELECTION + 5)
    const summary = selectionSummary(selectVisible(EMPTY_SELECTION, visible), visible)
    expect(summary.count).toBe(MAX_BATCH_SELECTION)
    expect(summary.allVisibleSelected).toBe(false)
    expect(summary.someVisibleSelected).toBe(true)
    expect(summary.atLimit).toBe(true)
  })
})

describe('selectedItems', () => {
  it('keeps the order of the list, not the order things were ticked', () => {
    const items = rows('a.md', 'b.md', 'c.md')
    expect(selectedItems(items, selection('c.md', 'a.md'))).toEqual([
      { relPath: 'a.md' },
      { relPath: 'c.md' },
    ])
  })

  it('is empty when nothing is chosen', () => {
    expect(selectedItems(rows('a.md'), EMPTY_SELECTION)).toEqual([])
  })

  it('ignores a chosen path that is not in the list', () => {
    expect(selectedItems(rows('a.md'), selection('a.md', 'fantasma.md'))).toEqual([
      { relPath: 'a.md' },
    ])
  })
})

describe('selectionCountLabel', () => {
  it('is singular for one', () => {
    expect(selectionCountLabel(1)).toBe('1 nota seleccionada')
  })

  it('is plural for the rest', () => {
    expect(selectionCountLabel(3)).toBe('3 notas seleccionadas')
    expect(selectionCountLabel(0)).toBe('0 notas seleccionadas')
  })
})

describe('selectionLimitLabel', () => {
  it('says the limit with its number', () => {
    expect(selectionLimitLabel(25)).toBe('Máximo 25 notas por tanda')
  })

  it('defaults to the constant, so the message cannot drift from it', () => {
    expect(selectionLimitLabel()).toBe(`Máximo ${MAX_BATCH_SELECTION} notas por tanda`)
  })
})
