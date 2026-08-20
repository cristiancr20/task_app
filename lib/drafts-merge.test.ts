import { describe, expect, it } from 'vitest'

import type { DraftRow, DraftsState } from '@/lib/drafts-store'
import { mergeDrafts } from '@/lib/drafts-merge'
import { emptyInsights } from '@/lib/extractors/task'

function row(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: 'row-1',
    title: 'Enviar el presupuesto',
    description: '',
    priority: 'none',
    mentioned: null,
    dueDate: null,
    evidence: '',
    include: true,
    ...overrides,
  }
}

const EMPTY: DraftsState = { rows: [], baseline: [], extracted: false, ...emptyInsights() }

function state(overrides: Partial<DraftsState> = {}): DraftsState {
  return { ...EMPTY, ...overrides }
}

describe('a table nothing happened to', () => {
  it('becomes what was stored', () => {
    const stored = state({ rows: [row()], baseline: [row()], extracted: true })

    expect(mergeDrafts(EMPTY, stored)).toEqual(stored)
  })

  it('stays empty when nothing was stored either', () => {
    expect(mergeDrafts(EMPTY, EMPTY)).toEqual(EMPTY)
  })

  // «The model found none» is a result, and the table words it differently
  // from a note nobody has extracted — so it has to survive the read.
  it('restores an extraction that found nothing', () => {
    const stored = state({ extracted: true })

    expect(mergeDrafts(EMPTY, stored)).toEqual(stored)
  })
})

describe('a table an extraction landed in first', () => {
  /**
   * The read left before the extraction did, so its answer is older than what
   * is on screen — and what is on screen cost a model call.
   */
  it('keeps the extraction and drops the stale read', () => {
    const fresh = state({ rows: [row({ id: 'row-9' })], baseline: [row({ id: 'row-9' })], extracted: true })
    const stored = state({ rows: [row({ id: 'row-1' })] })

    expect(mergeDrafts(fresh, stored)).toEqual(fresh)
  })

  it('keeps an extraction that returned nothing', () => {
    const fresh = state({ extracted: true })
    const stored = state({ rows: [row()] })

    expect(mergeDrafts(fresh, stored)).toEqual(fresh)
  })

  it('keeps a table whose rows were all deleted since the extraction', () => {
    const fresh = state({ baseline: [row()], extracted: true })
    const stored = state({ rows: [row()], baseline: [row()], extracted: true })

    expect(mergeDrafts(fresh, stored)).toEqual(fresh)
  })

  // The lists on screen came out of the extraction that just landed; the ones
  // on disk are what the note said before it, and a slow read must not put
  // them back next to the new rows.
  it('keeps the lists the extraction on screen produced', () => {
    const fresh = state({
      extracted: true,
      decisions: [{ text: 'Ship in September', decidedBy: null, evidence: 'lo sacamos' }],
    })
    const stored = state({
      extracted: true,
      decisions: [{ text: 'Ship in July', decidedBy: null, evidence: 'lo sacamos en julio' }],
    })

    expect(mergeDrafts(fresh, stored)).toEqual(fresh)
  })

  // Without this the count restarts at zero and «Generar tareas» stops warning
  // about the edits it is about to discard.
  it('keeps the baseline the count is measured against', () => {
    const fresh = state({
      rows: [row({ title: 'Editada' })],
      baseline: [row()],
      extracted: true,
    })

    expect(mergeDrafts(fresh, state({ baseline: [] })).baseline).toEqual([row()])
  })
})

describe('rows typed while the read was out', () => {
  const typed = row({ id: 'row-2', title: 'Escrita mientras cargaba' })

  it('keeps both sides', () => {
    const stored = state({ rows: [row({ id: 'row-1' })] })

    expect(mergeDrafts(state({ rows: [typed] }), stored).rows).toEqual([
      row({ id: 'row-1' }),
      typed,
    ])
  })

  it('puts the stored rows first, leaving the new one where it was added', () => {
    const stored = state({ rows: [row({ id: 'row-1' }), row({ id: 'row-3' })] })

    const merged = mergeDrafts(state({ rows: [typed] }), stored)

    expect(merged.rows.map((each) => each.id)).toEqual(['row-1', 'row-3', 'row-2'])
  })

  it('takes the baseline and the extraction flag from disk', () => {
    const stored = state({ rows: [row({ id: 'row-1' })], baseline: [row({ id: 'row-1' })], extracted: true })

    const merged = mergeDrafts(state({ rows: [typed] }), stored)

    expect(merged.baseline).toEqual([row({ id: 'row-1' })])
    expect(merged.extracted).toBe(true)
  })

  // Same reasoning as the baseline: they came out of the extraction this page
  // never saw, and a row typed by hand never decided anything.
  it('takes what the meeting decided, risked and asked from disk', () => {
    const decisions = [{ text: 'Ship in September', decidedBy: 'Ana', evidence: 'lo sacamos' }]
    const stored = state({ rows: [row({ id: 'row-1' })], extracted: true, decisions })

    const merged = mergeDrafts(state({ rows: [typed] }), stored)

    expect(merged.decisions).toEqual(decisions)
    expect(merged.risks).toEqual([])
    expect(merged.openQuestions).toEqual([])
  })

  /**
   * The page that typed this row never managed to read the file, so its key
   * generator restarted with no idea which keys were already taken. Two rows on
   * one key is one React key for both: an edit lands on both, and «Eliminar»
   * removes the wrong one.
   */
  it('re-keys a row that landed on a stored key', () => {
    const collision = row({ id: 'row-1', title: 'Escrita mientras cargaba' })
    const stored = state({ rows: [row({ id: 'row-1' })] })

    const merged = mergeDrafts(state({ rows: [collision] }), stored)

    expect(merged.rows.map((each) => each.id)).toEqual(['row-1', 'row-1-b'])
    expect(merged.rows[1].title).toBe('Escrita mientras cargaba')
  })

  it('leaves every key unique however many collide', () => {
    const stored = state({ rows: [row({ id: 'row-1' }), row({ id: 'row-2' })] })
    const memory = state({ rows: [row({ id: 'row-1' }), row({ id: 'row-2' }), row({ id: 'row-7' })] })

    const merged = mergeDrafts(memory, stored)

    expect(new Set(merged.rows.map((each) => each.id)).size).toBe(merged.rows.length)
  })

  it('does not re-key a row whose id nothing stored claims', () => {
    const stored = state({ rows: [row({ id: 'row-1' })] })

    expect(mergeDrafts(state({ rows: [typed] }), stored).rows[1].id).toBe('row-2')
  })

  it('keeps the typed rows when there was nothing stored after all', () => {
    expect(mergeDrafts(state({ rows: [typed] }), EMPTY)).toEqual(state({ rows: [typed] }))
  })

  it('does not touch either side’s row objects', () => {
    const stored = state({ rows: [row({ id: 'row-1' })] })
    const memory = state({ rows: [typed] })

    mergeDrafts(memory, stored)

    expect(memory.rows).toEqual([typed])
    expect(stored.rows).toEqual([row({ id: 'row-1' })])
  })
})
