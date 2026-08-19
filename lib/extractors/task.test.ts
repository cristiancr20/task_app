import { describe, expect, it } from 'vitest'

import { buildUserPrompt, normalizeTasks, PRIORITIES } from '@/lib/extractors/task'
import type { TranscriptMeta } from '@/lib/transcripts'

/** A well-formed row, so each test can vary only the field it is about. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Send the Q3 budget to Marta',
    description: 'Cristian owes Marta the Q3 budget before Friday.',
    priority: 'high',
    mentioned: 'Cristian',
    evidence: 'Cristian: yo te paso el presupuesto del Q3 antes del viernes.',
    ...overrides,
  }
}

function meta(overrides: Partial<TranscriptMeta> = {}): TranscriptMeta {
  return {
    relPath: 'weekly/2026-03-04 Weekly sync.md',
    fileName: '2026-03-04 Weekly sync.md',
    title: 'Weekly sync',
    date: '2026-03-04',
    attendees: ['Ana', 'Beto'],
    words: 120,
    approxTokens: 160,
    hasFrontmatter: true,
    ...overrides,
  }
}

describe('normalizeTasks: the shape of the payload', () => {
  it('accepts the { tasks: [...] } wrapper the schema asks for', () => {
    expect(normalizeTasks({ tasks: [row()] })).toEqual([
      {
        title: 'Send the Q3 budget to Marta',
        description: 'Cristian owes Marta the Q3 budget before Friday.',
        priority: 'high',
        mentioned: 'Cristian',
        evidence: 'Cristian: yo te paso el presupuesto del Q3 antes del viernes.',
      },
    ])
  })

  it('accepts a bare array at the root, which models answer with anyway', () => {
    expect(normalizeTasks([row({ title: 'Bare' })])).toEqual([
      expect.objectContaining({ title: 'Bare' }),
    ])
  })

  it('ignores the wrapper when it is present but not an array', () => {
    expect(normalizeTasks({ tasks: { title: 'Suelta' } })).toEqual([])
    expect(normalizeTasks({ tasks: 'ninguna' })).toEqual([])
    expect(normalizeTasks({ tasks: null })).toEqual([])
  })

  // Every one of these reaches normalizeTasks when a model answers off-contract.
  // None may throw: the caller turns an empty list into "no tasks found".
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'no tasks here'],
    ['the empty string', ''],
    ['a number', 42],
    ['a boolean', true],
    ['an object without tasks', { items: [row()] }],
    ['an empty object', {}],
    ['an empty array', []],
  ])('returns an empty array for %s, without throwing', (_label, payload) => {
    expect(() => normalizeTasks(payload)).not.toThrow()
    expect(normalizeTasks(payload)).toEqual([])
  })

  it('drops rows that are not objects but keeps the ones around them', () => {
    const tasks = normalizeTasks({
      tasks: [null, 'texto', 7, row({ title: 'La buena' }), [], undefined],
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('La buena')
  })
})

describe('normalizeTasks: the title decides whether a row survives', () => {
  it('discards a row with no title key at all', () => {
    const { title: _title, ...untitled } = row()
    expect(normalizeTasks({ tasks: [untitled] })).toEqual([])
  })

  it.each([
    ['is empty', ''],
    ['is only spaces', '   '],
    ['is only whitespace of other kinds', '\t\n '],
    ['is null', null],
    ['is undefined', undefined],
    ['is an object', { text: 'Algo' }],
    ['is an array', ['Algo']],
  ])('discards a row whose title %s', (_label, title) => {
    expect(normalizeTasks({ tasks: [row({ title })] })).toEqual([])
  })

  it('trims the surviving title', () => {
    expect(normalizeTasks({ tasks: [row({ title: '  Enviar el reporte  ' })] })[0].title).toBe(
      'Enviar el reporte',
    )
  })
})

describe('normalizeTasks: priority', () => {
  it.each(PRIORITIES)('keeps %s, one of the five Linear levels', (priority) => {
    expect(normalizeTasks({ tasks: [row({ priority })] })[0].priority).toBe(priority)
  })

  it.each([
    ['an invented level', 'blocker'],
    ['a near miss', 'urgente'],
    ['null', null],
    ['undefined', undefined],
    ['the empty string', ''],
    ['only spaces', '   '],
    ['an object', { level: 'high' }],
    ['an array', ['high']],
  ])('falls back to none for %s', (_label, priority) => {
    expect(normalizeTasks({ tasks: [row({ priority })] })[0].priority).toBe('none')
  })

  // Linear's numeric scale (1 = urgent) is what a model reaches for when it
  // ignores the enum; a number is not a level, so it must not sneak through.
  it.each([0, 1, 2, 3, 4])('falls back to none for the numeric priority %i', (priority) => {
    expect(normalizeTasks({ tasks: [row({ priority })] })[0].priority).toBe('none')
  })

  it('lowercases a shouted level instead of dropping it', () => {
    expect(normalizeTasks({ tasks: [row({ priority: 'HIGH' })] })[0].priority).toBe('high')
    expect(normalizeTasks({ tasks: [row({ priority: 'Urgent' })] })[0].priority).toBe('urgent')
    expect(normalizeTasks({ tasks: [row({ priority: '  MeDiUm  ' })] })[0].priority).toBe('medium')
  })
})

describe('normalizeTasks: mentioned', () => {
  it.each([
    ['is missing', undefined],
    ['is null', null],
    ['is empty', ''],
    ['is only spaces', '    '],
    ['is an object', { name: 'Ana' }],
  ])('is null when it %s', (_label, mentioned) => {
    expect(normalizeTasks({ tasks: [row({ mentioned })] })[0].mentioned).toBeNull()
  })

  it('keeps a name, trimmed', () => {
    expect(normalizeTasks({ tasks: [row({ mentioned: '  Ana Rodríguez \n' })] })[0].mentioned).toBe(
      'Ana Rodríguez',
    )
  })
})

describe('normalizeTasks: non-string scalars become strings', () => {
  it('stringifies a numeric title instead of discarding the row', () => {
    const tasks = normalizeTasks({ tasks: [row({ title: 2026 })] })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('2026')
  })

  it('stringifies numbers and booleans in description and evidence', () => {
    const [task] = normalizeTasks({
      tasks: [row({ description: 42, evidence: false, mentioned: 7 })],
    })
    expect(task.description).toBe('42')
    expect(task.evidence).toBe('false')
    expect(task.mentioned).toBe('7')
  })

  it('empties description and evidence when they are neither string nor scalar', () => {
    const [task] = normalizeTasks({
      tasks: [row({ description: { text: 'algo' }, evidence: null })],
    })
    expect(task.description).toBe('')
    expect(task.evidence).toBe('')
  })

  it('drops the extra keys a model adds beyond the contract', () => {
    const [task] = normalizeTasks({ tasks: [row({ dueDate: '2026-09-01', assigneeId: 'abc' })] })
    expect(Object.keys(task).sort()).toEqual([
      'description',
      'evidence',
      'mentioned',
      'priority',
      'title',
    ])
  })
})

describe('buildUserPrompt', () => {
  it('includes the date and the attendees when the transcript has them', () => {
    const prompt = buildUserPrompt('Ana: yo lo mando.', meta())
    expect(prompt).toContain('Title: Weekly sync')
    expect(prompt).toContain('Date: 2026-03-04')
    expect(prompt).toContain('Attendees: Ana, Beto')
  })

  it('leaves the date line out when there is no date', () => {
    const prompt = buildUserPrompt('Ana: yo lo mando.', meta({ date: null }))
    expect(prompt).not.toContain('Date:')
    expect(prompt).toContain('Attendees: Ana, Beto')
  })

  it('leaves the attendees line out when nobody is listed', () => {
    const prompt = buildUserPrompt('Ana: yo lo mando.', meta({ attendees: [] }))
    expect(prompt).not.toContain('Attendees:')
    expect(prompt).toContain('Date: 2026-03-04')
  })

  it('keeps only the title line when neither date nor attendees exist', () => {
    const prompt = buildUserPrompt('Ana: yo lo mando.', meta({ date: null, attendees: [] }))
    expect(prompt.split('\n')[0]).toBe('Title: Weekly sync')
    expect(prompt).not.toContain('Date:')
    expect(prompt).not.toContain('Attendees:')
  })

  it('trims the transcript and closes with the instruction', () => {
    const prompt = buildUserPrompt('\n\n  Ana: yo lo mando.  \n\n', meta())
    expect(prompt).toContain('Transcript:\nAna: yo lo mando.\n')
    expect(prompt.endsWith('Extract the action items as JSON.')).toBe(true)
  })
})
