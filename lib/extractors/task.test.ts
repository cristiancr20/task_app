import { describe, expect, it } from 'vitest'

import {
  buildUserPrompt,
  emptyExtraction,
  normalizeExtraction,
  normalizeTasks,
  PRIORITIES,
  withTimeout,
} from '@/lib/extractors/task'
import type { TranscriptMeta } from '@/lib/transcripts'

/** A well-formed row, so each test can vary only the field it is about. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Send the Q3 budget to Marta',
    description: 'Cristian owes Marta the Q3 budget before Friday.',
    priority: 'high',
    mentioned: 'Cristian',
    dueDate: '2026-03-06',
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
        dueDate: '2026-03-06',
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

describe('normalizeTasks: dueDate', () => {
  it('keeps a well-formed YYYY-MM-DD date', () => {
    expect(normalizeTasks({ tasks: [row({ dueDate: '2026-08-19' })] })[0].dueDate).toBe(
      '2026-08-19',
    )
  })

  it('keeps the last day of a leap February', () => {
    expect(normalizeTasks({ tasks: [row({ dueDate: '2028-02-29' })] })[0].dueDate).toBe(
      '2028-02-29',
    )
  })

  it('trims the surrounding whitespace before validating', () => {
    expect(normalizeTasks({ tasks: [row({ dueDate: '  2026-08-19 ' })] })[0].dueDate).toBe(
      '2026-08-19',
    )
  })

  // The model was asked to resolve these against the meeting date; when it
  // answers with the phrase itself the date is unknowable, not empty-ish.
  it.each([
    ['a relative phrase', 'next Friday'],
    ['a phrase in the transcript language', 'antes de fin de mes'],
    ['a European format', '19/08/2026'],
    ['an American format', '08-19-2026'],
    ['a date with no padding', '2026-8-9'],
    ['a year alone', '2026'],
    ['a month alone', '2026-08'],
    ['the empty string', ''],
    ['only spaces', '   '],
    ['a sentence around a date', 'due on 2026-08-19'],
  ])('is null for %s', (_label, dueDate) => {
    expect(normalizeTasks({ tasks: [row({ dueDate })] })[0].dueDate).toBeNull()
  })

  // A day out of its month's range would reach Linear as a rejected mutation.
  it.each([
    ['a February that never happened', '2026-02-31'],
    ['a 29th of a non-leap February', '2026-02-29'],
    ['a 31st of a 30-day month', '2026-04-31'],
    ['day zero', '2026-08-00'],
    ['day 32', '2026-08-32'],
    ['month zero', '2026-00-19'],
    ['month 13', '2026-13-19'],
  ])('is null for %s', (_label, dueDate) => {
    expect(normalizeTasks({ tasks: [row({ dueDate })] })[0].dueDate).toBeNull()
  })

  it('trims a full ISO timestamp down to its date instead of discarding it', () => {
    expect(normalizeTasks({ tasks: [row({ dueDate: '2026-08-19T00:00:00Z' })] })[0].dueDate).toBe(
      '2026-08-19',
    )
    expect(
      normalizeTasks({ tasks: [row({ dueDate: '2026-08-19T17:30:00+02:00' })] })[0].dueDate,
    ).toBe('2026-08-19')
  })

  it('discards a timestamp whose date part is impossible', () => {
    expect(
      normalizeTasks({ tasks: [row({ dueDate: '2026-02-31T00:00:00Z' })] })[0].dueDate,
    ).toBeNull()
  })

  it.each([
    ['the field is missing', undefined],
    ['it is null', null],
    ['it is a number', 20260819],
    ['it is a boolean', true],
    ['it is an object', { date: '2026-08-19' }],
    ['it is an array', ['2026-08-19']],
  ])('is null when %s', (_label, dueDate) => {
    expect(normalizeTasks({ tasks: [row({ dueDate })] })[0].dueDate).toBeNull()
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
    const [task] = normalizeTasks({ tasks: [row({ labels: ['infra'], assigneeId: 'abc' })] })
    expect(Object.keys(task).sort()).toEqual([
      'description',
      'dueDate',
      'evidence',
      'mentioned',
      'priority',
      'title',
    ])
  })
})

/** A well-formed decision, so each test varies only the field it is about. */
function decision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text: 'The team ships with Postgres instead of MySQL.',
    decidedBy: 'Ana',
    evidence: 'Ana: nos quedamos con Postgres, cerrado.',
    ...overrides,
  }
}

function risk(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text: 'The migration may not fit before the launch date.',
    affects: 'the October launch',
    evidence: 'Beto: si la migración se alarga no llegamos a octubre.',
    ...overrides,
  }
}

function question(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text: 'Who pays for the extra database instance?',
    evidence: 'Beto: ¿y quién paga la instancia extra?',
    ...overrides,
  }
}

describe('normalizeExtraction: the four lists travel together', () => {
  it('returns each list from the payload the schema asks for', () => {
    expect(
      normalizeExtraction({
        tasks: [row()],
        decisions: [decision()],
        risks: [risk()],
        openQuestions: [question()],
      }),
    ).toEqual({
      tasks: [
        {
          title: 'Send the Q3 budget to Marta',
          description: 'Cristian owes Marta the Q3 budget before Friday.',
          priority: 'high',
          mentioned: 'Cristian',
          dueDate: '2026-03-06',
          evidence: 'Cristian: yo te paso el presupuesto del Q3 antes del viernes.',
        },
      ],
      decisions: [
        {
          text: 'The team ships with Postgres instead of MySQL.',
          decidedBy: 'Ana',
          evidence: 'Ana: nos quedamos con Postgres, cerrado.',
        },
      ],
      risks: [
        {
          text: 'The migration may not fit before the launch date.',
          affects: 'the October launch',
          evidence: 'Beto: si la migración se alarga no llegamos a octubre.',
        },
      ],
      openQuestions: [
        { text: 'Who pays for the extra database instance?', evidence: 'Beto: ¿y quién paga la instancia extra?' },
      ],
    })
  })

  // The three lists are new: a model that only answers `tasks` is the payload
  // every older prompt produced, and it must still be a valid extraction.
  it('treats the three new lists as empty when the payload has none of them', () => {
    expect(normalizeExtraction({ tasks: [row()] })).toEqual({
      tasks: [expect.objectContaining({ title: 'Send the Q3 budget to Marta' })],
      decisions: [],
      risks: [],
      openQuestions: [],
    })
  })

  it('still reads the tasks from a bare array, with the other three empty', () => {
    expect(normalizeExtraction([row({ title: 'Bare' })])).toEqual({
      tasks: [expect.objectContaining({ title: 'Bare' })],
      decisions: [],
      risks: [],
      openQuestions: [],
    })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nothing happened'],
    ['a number', 42],
    ['a boolean', true],
    ['an empty object', {}],
    ['an empty array', []],
    ['an object with none of the four keys', { items: [row()] }],
  ])('returns four empty lists for %s, without throwing', (_label, payload) => {
    expect(() => normalizeExtraction(payload)).not.toThrow()
    expect(normalizeExtraction(payload)).toEqual(emptyExtraction())
  })

  it.each([
    ['an object', { text: 'Algo' }],
    ['a string', 'ninguna'],
    ['null', null],
    ['a number', 3],
  ])('ignores a list that is present but is %s', (_label, value) => {
    expect(
      normalizeExtraction({ decisions: value, risks: value, openQuestions: value }),
    ).toEqual(emptyExtraction())
  })

  it('leaves the other lists alone when one of them is unusable', () => {
    const result = normalizeExtraction({
      tasks: 'ninguna',
      decisions: [decision()],
      risks: null,
      openQuestions: [question()],
    })
    expect(result.tasks).toEqual([])
    expect(result.risks).toEqual([])
    expect(result.decisions).toHaveLength(1)
    expect(result.openQuestions).toHaveLength(1)
  })

  it('hands back a fresh empty result each time, so callers cannot share one', () => {
    const first = emptyExtraction()
    first.decisions.push({ text: 'x', decidedBy: null, evidence: '' })
    expect(emptyExtraction().decisions).toEqual([])
  })
})

describe('normalizeExtraction: decisions', () => {
  it.each([
    ['it is empty', { text: '' }],
    ['it is only spaces', { text: '   ' }],
    ['it is only whitespace of other kinds', { text: '\t\n ' }],
    ['it is null', { text: null }],
    ['it is an object', { text: { value: 'Algo' } }],
    ['it is an array', { text: ['Algo'] }],
  ])('discards a decision whose text %s', (_label, overrides) => {
    expect(normalizeExtraction({ decisions: [decision(overrides)] }).decisions).toEqual([])
  })

  it('discards a decision with no text key at all', () => {
    const { text: _text, ...textless } = decision()
    expect(normalizeExtraction({ decisions: [textless] }).decisions).toEqual([])
  })

  it('drops entries that are not objects but keeps the ones around them', () => {
    const { decisions } = normalizeExtraction({
      decisions: [null, 'texto', 7, decision({ text: 'La buena' }), [], undefined],
    })
    expect(decisions).toHaveLength(1)
    expect(decisions[0].text).toBe('La buena')
  })

  it('trims the text and the evidence', () => {
    const [entry] = normalizeExtraction({
      decisions: [decision({ text: '  Se usa Postgres.  ', evidence: '\n Ana: cerrado. \n' })],
    }).decisions
    expect(entry.text).toBe('Se usa Postgres.')
    expect(entry.evidence).toBe('Ana: cerrado.')
  })

  it.each([
    ['is missing', undefined],
    ['is null', null],
    ['is empty', ''],
    ['is only spaces', '    '],
    ['is an object', { name: 'Ana' }],
    ['is an array', ['Ana']],
  ])('reads decidedBy as null when it %s', (_label, decidedBy) => {
    expect(
      normalizeExtraction({ decisions: [decision({ decidedBy })] }).decisions[0].decidedBy,
    ).toBeNull()
  })

  it('keeps decidedBy, trimmed', () => {
    expect(
      normalizeExtraction({ decisions: [decision({ decidedBy: '  Ana Rodríguez \n' })] })
        .decisions[0].decidedBy,
    ).toBe('Ana Rodríguez')
  })

  it('empties an evidence that is neither string nor scalar', () => {
    expect(
      normalizeExtraction({ decisions: [decision({ evidence: { line: 'algo' } })] }).decisions[0]
        .evidence,
    ).toBe('')
  })

  it('stringifies the scalars a model answers with instead of dropping the entry', () => {
    const [entry] = normalizeExtraction({
      decisions: [decision({ text: 2026, decidedBy: 7, evidence: false })],
    }).decisions
    expect(entry).toEqual({ text: '2026', decidedBy: '7', evidence: 'false' })
  })

  it('drops the extra keys a model adds beyond the contract', () => {
    const [entry] = normalizeExtraction({
      decisions: [decision({ priority: 'high', dueDate: '2026-03-06' })],
    }).decisions
    expect(Object.keys(entry).sort()).toEqual(['decidedBy', 'evidence', 'text'])
  })
})

describe('normalizeExtraction: risks', () => {
  it.each([
    ['it is empty', { text: '' }],
    ['it is only spaces', { text: '   ' }],
    ['it is null', { text: null }],
    ['it is an object', { text: { value: 'Algo' } }],
    ['it is an array', { text: ['Algo'] }],
  ])('discards a risk whose text %s', (_label, overrides) => {
    expect(normalizeExtraction({ risks: [risk(overrides)] }).risks).toEqual([])
  })

  it('discards a risk with no text key at all', () => {
    const { text: _text, ...textless } = risk()
    expect(normalizeExtraction({ risks: [textless] }).risks).toEqual([])
  })

  it('drops entries that are not objects but keeps the ones around them', () => {
    const { risks } = normalizeExtraction({
      risks: [null, 'texto', 7, risk({ text: 'El bueno' }), [], undefined],
    })
    expect(risks).toHaveLength(1)
    expect(risks[0].text).toBe('El bueno')
  })

  it('trims the text and the evidence', () => {
    const [entry] = normalizeExtraction({
      risks: [risk({ text: '  No llegamos.  ', evidence: '  Beto: no llegamos a octubre.  ' })],
    }).risks
    expect(entry.text).toBe('No llegamos.')
    expect(entry.evidence).toBe('Beto: no llegamos a octubre.')
  })

  it.each([
    ['is missing', undefined],
    ['is null', null],
    ['is empty', ''],
    ['is only spaces', '    '],
    ['is an object', { scope: 'launch' }],
    ['is an array', ['launch']],
  ])('reads affects as null when it %s', (_label, affects) => {
    expect(normalizeExtraction({ risks: [risk({ affects })] }).risks[0].affects).toBeNull()
  })

  it('keeps affects, trimmed', () => {
    expect(
      normalizeExtraction({ risks: [risk({ affects: '  el lanzamiento de octubre  ' })] }).risks[0]
        .affects,
    ).toBe('el lanzamiento de octubre')
  })

  it('drops the extra keys a model adds beyond the contract', () => {
    const [entry] = normalizeExtraction({ risks: [risk({ decidedBy: 'Ana', severity: 3 })] }).risks
    expect(Object.keys(entry).sort()).toEqual(['affects', 'evidence', 'text'])
  })
})

describe('normalizeExtraction: open questions', () => {
  it.each([
    ['it is empty', { text: '' }],
    ['it is only spaces', { text: '   ' }],
    ['it is null', { text: null }],
    ['it is an object', { text: { value: 'Algo' } }],
    ['it is an array', { text: ['Algo'] }],
  ])('discards a question whose text %s', (_label, overrides) => {
    expect(normalizeExtraction({ openQuestions: [question(overrides)] }).openQuestions).toEqual([])
  })

  it('discards a question with no text key at all', () => {
    const { text: _text, ...textless } = question()
    expect(normalizeExtraction({ openQuestions: [textless] }).openQuestions).toEqual([])
  })

  it('drops entries that are not objects but keeps the ones around them', () => {
    const { openQuestions } = normalizeExtraction({
      openQuestions: [null, 'texto', 7, question({ text: 'La buena' }), [], undefined],
    })
    expect(openQuestions).toHaveLength(1)
    expect(openQuestions[0].text).toBe('La buena')
  })

  it('trims the text and the evidence', () => {
    const [entry] = normalizeExtraction({
      openQuestions: [question({ text: '  ¿Quién paga?  ', evidence: '  Beto: ¿quién paga?  ' })],
    }).openQuestions
    expect(entry.text).toBe('¿Quién paga?')
    expect(entry.evidence).toBe('Beto: ¿quién paga?')
  })

  it('empties an evidence that is neither string nor scalar', () => {
    expect(
      normalizeExtraction({ openQuestions: [question({ evidence: null })] }).openQuestions[0]
        .evidence,
    ).toBe('')
  })

  // A question is the one list with no second field; anything the model adds —
  // an answer, an owner — must not travel as if the contract had it.
  it('drops the extra keys a model adds beyond the contract', () => {
    const [entry] = normalizeExtraction({
      openQuestions: [question({ answer: 'Nadie', decidedBy: 'Ana' })],
    }).openQuestions
    expect(Object.keys(entry).sort()).toEqual(['evidence', 'text'])
  })
})

describe('buildUserPrompt', () => {
  it('includes the date and the attendees when the transcript has them', () => {
    const prompt = buildUserPrompt('Ana: yo lo mando.', meta())
    expect(prompt).toContain('Title: Weekly sync')
    expect(prompt).toContain('Meeting date: 2026-03-04')
    expect(prompt).toContain('Attendees: Ana, Beto')
  })

  // The date is the anchor every relative deadline is resolved against, so the
  // prompt says what it is for instead of just stating it.
  it('presents the date as the anchor for relative deadlines', () => {
    expect(buildUserPrompt('Ana: yo lo mando.', meta())).toContain(
      'Meeting date: 2026-03-04 — resolve every relative deadline against this date.',
    )
  })

  it('says the deadlines cannot be resolved when the note has no date', () => {
    const prompt = buildUserPrompt('Ana: yo lo mando.', meta({ date: null }))
    expect(prompt).toContain('Meeting date: unknown')
    expect(prompt).toContain('dueDate null')
    expect(prompt).toContain('Attendees: Ana, Beto')
  })

  it('leaves the attendees line out when nobody is listed', () => {
    const prompt = buildUserPrompt('Ana: yo lo mando.', meta({ attendees: [] }))
    expect(prompt).not.toContain('Attendees:')
    expect(prompt).toContain('Meeting date: 2026-03-04')
  })

  it('keeps the title and the date lines when nobody is listed and there is no date', () => {
    const prompt = buildUserPrompt('Ana: yo lo mando.', meta({ date: null, attendees: [] }))
    expect(prompt.split('\n')[0]).toBe('Title: Weekly sync')
    expect(prompt).toContain('Meeting date: unknown')
    expect(prompt).not.toContain('Attendees:')
  })

  it('trims the transcript and closes with the instruction', () => {
    const prompt = buildUserPrompt('\n\n  Ana: yo lo mando.  \n\n', meta())
    expect(prompt).toContain('Transcript:\nAna: yo lo mando.\n')
    expect(
      prompt.endsWith('Extract the action items, decisions, risks and open questions as JSON.'),
    ).toBe(true)
  })
})

describe('withTimeout', () => {
  /** Resolves once `signal` aborts, so a test can await the abort rather than a clock. */
  function aborted(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve()
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }

  it('aborts when the caller aborts, long before the timeout', () => {
    const caller = new AbortController()
    const signal = withTimeout(caller.signal, 60_000)

    expect(signal.aborted).toBe(false)
    caller.abort()

    expect(signal.aborted).toBe(true)
  })

  it('comes back already aborted when the caller gave up first', () => {
    const caller = new AbortController()
    caller.abort()

    expect(withTimeout(caller.signal, 60_000).aborted).toBe(true)
  })

  it('still aborts on the timeout when a caller signal is passed', async () => {
    // The point of combining rather than choosing: a caller that never aborts
    // must not leave a wedged provider hanging a request no clock owns.
    const caller = new AbortController()

    await aborted(withTimeout(caller.signal, 1))

    expect(caller.signal.aborted).toBe(false)
  })

  it('is just the timeout when nobody passes a signal', async () => {
    const signal = withTimeout(undefined, 1)

    expect(signal.aborted).toBe(false)
    await aborted(signal)

    expect(signal.aborted).toBe(true)
  })
})
