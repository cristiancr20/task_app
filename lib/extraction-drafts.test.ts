import { describe, expect, it } from 'vitest'

import { createDraftIds } from '@/lib/draft-ids'
import { draftsFromExtraction } from '@/lib/extraction-drafts'
import { emptyExtraction, type ExtractedTask, type ExtractionResult } from '@/lib/extractors/task'

function task(title: string): ExtractedTask {
  return {
    title,
    description: 'lo que hay que hacer',
    priority: 'high',
    mentioned: 'Ana',
    dueDate: '2026-09-01',
    evidence: 'Ana lo dijo',
  }
}

function extraction(...titles: string[]): ExtractionResult {
  return { ...emptyExtraction(), tasks: titles.map(task) }
}

/** The keys the table hands out, so a test reads `row-1`, `row-2`… */
function ids(): () => string {
  const source = createDraftIds()
  return () => source.next()
}

describe('draftsFromExtraction', () => {
  it('turns every task into a row with a key of its own', () => {
    const state = draftsFromExtraction(extraction('Una', 'Otra'), ids())

    expect(state.rows.map((row) => row.id)).toEqual(['row-1', 'row-2'])
    expect(state.rows.map((row) => row.title)).toEqual(['Una', 'Otra'])
  })

  it('includes every row: curating is opting out', () => {
    const state = draftsFromExtraction(extraction('Una', 'Otra'), ids())
    expect(state.rows.every((row) => row.include)).toBe(true)
  })

  it('keeps everything the extractor said about the task', () => {
    const [row] = draftsFromExtraction(extraction('Una'), ids()).rows

    expect(row).toMatchObject({
      description: 'lo que hay que hacer',
      priority: 'high',
      mentioned: 'Ana',
      dueDate: '2026-09-01',
      evidence: 'Ana lo dijo',
    })
  })

  it('makes the rows the baseline, so nothing counts as edited yet', () => {
    const state = draftsFromExtraction(extraction('Una'), ids())
    expect(state.baseline).toEqual(state.rows)
  })

  it('marks the note as extracted, so «ninguna tarea» means the model found none', () => {
    const state = draftsFromExtraction(emptyExtraction(), ids())

    expect(state.extracted).toBe(true)
    expect(state.rows).toEqual([])
  })

  it('carries the three lists that never become issues', () => {
    const result: ExtractionResult = {
      tasks: [],
      decisions: [{ text: 'Postgres', decidedBy: 'Ana', evidence: 'vamos con Postgres' }],
      risks: [{ text: 'La fecha', affects: 'la demo', evidence: 'no llegamos' }],
      openQuestions: [{ text: '¿Quién migra?', evidence: 'nadie dijo' }],
    }

    const state = draftsFromExtraction(result, ids())
    expect(state.decisions).toEqual(result.decisions)
    expect(state.risks).toEqual(result.risks)
    expect(state.openQuestions).toEqual(result.openQuestions)
  })

  it('takes its keys from the caller, so two notes can be built by two counters', () => {
    const shared = ids()
    const first = draftsFromExtraction(extraction('Una'), shared)
    const second = draftsFromExtraction(extraction('Otra'), shared)

    expect(first.rows[0].id).toBe('row-1')
    expect(second.rows[0].id).toBe('row-2')
  })
})
