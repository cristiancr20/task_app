import { describe, expect, it } from 'vitest'

import { countManualChanges, type ChangeableDrafts } from '@/lib/drafts-changes'
import type { DraftRow } from '@/lib/drafts-store'

function row(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: 'row-1',
    title: 'Enviar el presupuesto',
    description: 'Marta necesita el presupuesto del Q3.',
    priority: 'none',
    mentioned: null,
    dueDate: null,
    evidence: 'Yo te lo mando el viernes.',
    include: true,
    ...overrides,
  }
}

/** A table straight out of an extraction: the rows *are* the baseline. */
function extracted(rows: DraftRow[]): ChangeableDrafts {
  return { rows, baseline: rows.map((r) => ({ ...r })) }
}

describe('countManualChanges', () => {
  it('counts nothing for a file that has no state yet', () => {
    expect(countManualChanges(undefined)).toEqual({
      edited: 0,
      added: 0,
      removed: 0,
      total: 0,
    })
  })

  it('counts nothing for a table nobody has touched', () => {
    const changes = countManualChanges(extracted([row(), row({ id: 'row-2' })]))

    expect(changes).toEqual({ edited: 0, added: 0, removed: 0, total: 0 })
  })

  it('counts an edited title once, however many characters changed', () => {
    const state = extracted([row()])
    state.rows = [{ ...state.rows[0], title: 'Enviar el presupuesto del Q3 a Marta' }]

    expect(countManualChanges(state)).toMatchObject({ edited: 1, total: 1 })
  })

  it('counts rows added by hand and rows deleted', () => {
    const state = extracted([row(), row({ id: 'row-2' })])
    state.rows = [state.rows[1], row({ id: 'row-3' })]

    expect(countManualChanges(state)).toEqual({
      edited: 0,
      added: 1,
      removed: 1,
      total: 2,
    })
  })

  it('counts unchecking «incluir» as an edit', () => {
    const state = extracted([row()])
    state.rows = [{ ...state.rows[0], include: false }]

    expect(countManualChanges(state)).toMatchObject({ edited: 1, total: 1 })
  })
})

/**
 * The reason the column is editable at all: the model resolves «el viernes»
 * against the meeting date and gets it wrong, the user fixes the date and
 * nothing else, and a regenerate would take that correction back — so the
 * confirmation has to know about it.
 */
describe('countManualChanges: dueDate', () => {
  it('counts a corrected date as an edited row', () => {
    const state = extracted([row({ dueDate: '2026-08-21' })])
    state.rows = [{ ...state.rows[0], dueDate: '2026-08-28' }]

    expect(countManualChanges(state)).toEqual({
      edited: 1,
      added: 0,
      removed: 0,
      total: 1,
    })
  })

  it('counts a date typed onto a row the model left without one', () => {
    const state = extracted([row({ dueDate: null })])
    state.rows = [{ ...state.rows[0], dueDate: '2026-09-01' }]

    expect(countManualChanges(state)).toMatchObject({ edited: 1, total: 1 })
  })

  // Emptying the field stores null, so this is what a cleared column looks
  // like — and clearing an invented deadline is as much curation as fixing one.
  it('counts a cleared date as an edited row', () => {
    const state = extracted([row({ dueDate: '2026-08-21' })])
    state.rows = [{ ...state.rows[0], dueDate: null }]

    expect(countManualChanges(state)).toMatchObject({ edited: 1, total: 1 })
  })

  it('counts the same date on both sides as no change', () => {
    const state = extracted([row({ dueDate: '2026-08-21' })])

    expect(countManualChanges(state)).toEqual({ edited: 0, added: 0, removed: 0, total: 0 })
  })

  it('counts a row with the date and something else changed only once', () => {
    const state = extracted([row({ dueDate: '2026-08-21' })])
    state.rows = [{ ...state.rows[0], dueDate: '2026-08-28', priority: 'high' }]

    expect(countManualChanges(state)).toMatchObject({ edited: 1, total: 1 })
  })
})
