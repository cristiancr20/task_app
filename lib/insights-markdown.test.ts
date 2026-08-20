import { describe, expect, it } from 'vitest'

import { emptyInsights, type MeetingInsights } from '@/lib/extractors/task'
import {
  hasInsights,
  insightEntries,
  insightsCount,
  insightsMarkdown,
  listMarkdown,
} from '@/lib/insights-markdown'

function insights(overrides: Partial<MeetingInsights> = {}): MeetingInsights {
  return { ...emptyInsights(), ...overrides }
}

const DECIDED = {
  text: 'Ship the beta in September',
  decidedBy: 'Ana',
  evidence: 'Ana: lo sacamos en septiembre, decidido.',
}

const RISK = {
  text: 'The vendor may not deliver on time',
  affects: 'the launch date',
  evidence: 'Marta: el proveedor va con retraso.',
}

const QUESTION = {
  text: 'Who signs off on the pricing?',
  evidence: '¿quién firma el precio final?',
}

describe('insightEntries', () => {
  it('words who took a decision', () => {
    expect(insightEntries(insights({ decisions: [DECIDED] }), 'decisions')).toEqual([
      {
        text: 'Ship the beta in September',
        note: 'decidido por Ana',
        evidence: 'Ana: lo sacamos en septiembre, decidido.',
      },
    ])
  })

  it('words what a risk puts at stake', () => {
    expect(insightEntries(insights({ risks: [RISK] }), 'risks')).toEqual([
      {
        text: 'The vendor may not deliver on time',
        note: 'afecta a the launch date',
        evidence: 'Marta: el proveedor va con retraso.',
      },
    ])
  })

  // Null is «the transcript does not say», so the entry drops the note rather
  // than claiming nobody decided or that nothing is at stake.
  it('leaves an unattributed decision without a note', () => {
    expect(insightEntries(insights({ decisions: [{ ...DECIDED, decidedBy: null }] }), 'decisions')[0].note).toBeNull()
  })

  it('leaves a risk with no stated stake without a note', () => {
    expect(insightEntries(insights({ risks: [{ ...RISK, affects: null }] }), 'risks')[0].note).toBeNull()
  })

  // An open question has no second field at all: the question is the whole of it.
  it('gives an open question no note', () => {
    expect(insightEntries(insights({ openQuestions: [QUESTION] }), 'openQuestions')).toEqual([
      { text: 'Who signs off on the pricing?', note: null, evidence: '¿quién firma el precio final?' },
    ])
  })

  it('keeps the order of the list', () => {
    const list = insightEntries(
      insights({ openQuestions: [QUESTION, { ...QUESTION, text: 'Second' }] }),
      'openQuestions',
    )

    expect(list.map((entry) => entry.text)).toEqual(['Who signs off on the pricing?', 'Second'])
  })

  it('answers nothing for an empty list', () => {
    expect(insightEntries(insights(), 'decisions')).toEqual([])
  })
})

describe('listMarkdown', () => {
  it('writes a heading and one bullet per item', () => {
    expect(listMarkdown(insights({ decisions: [DECIDED] }), 'decisions')).toBe(
      [
        '## Decisiones',
        '',
        '- Ship the beta in September — decidido por Ana',
        '  > Ana: lo sacamos en septiembre, decidido.',
      ].join('\n'),
    )
  })

  it('names each list the way the panel does', () => {
    expect(listMarkdown(insights({ risks: [RISK] }), 'risks').split('\n')[0]).toBe('## Riesgos')
    expect(listMarkdown(insights({ openQuestions: [QUESTION] }), 'openQuestions').split('\n')[0]).toBe(
      '## Preguntas abiertas',
    )
  })

  it('writes a bullet with no note when there is none', () => {
    expect(listMarkdown(insights({ openQuestions: [QUESTION] }), 'openQuestions')).toBe(
      ['## Preguntas abiertas', '', '- Who signs off on the pricing?', '  > ¿quién firma el precio final?'].join(
        '\n',
      ),
    )
  })

  // The quote is indented under the bullet it belongs to; without one the item
  // is a bare bullet rather than an empty blockquote.
  it('writes a bullet with no quote when there is no evidence', () => {
    expect(listMarkdown(insights({ risks: [{ ...RISK, evidence: '' }] }), 'risks')).toBe(
      ['## Riesgos', '', '- The vendor may not deliver on time — afecta a the launch date'].join('\n'),
    )
  })

  it('writes several items in order', () => {
    const markdown = listMarkdown(
      insights({ decisions: [DECIDED, { text: 'Drop the CSV export', decidedBy: null, evidence: 'lo quitamos' }] }),
      'decisions',
    )

    expect(markdown.split('\n').slice(2)).toEqual([
      '- Ship the beta in September — decidido por Ana',
      '  > Ana: lo sacamos en septiembre, decidido.',
      '- Drop the CSV export',
      '  > lo quitamos',
    ])
  })

  // A newline inside a bullet would end the list item and turn the rest of the
  // text into a paragraph as soon as it was pasted.
  it('collapses newlines and runs of spaces onto one line', () => {
    const markdown = listMarkdown(
      insights({ risks: [{ text: 'Two\nlines', affects: ' a  date ', evidence: 'dijo:\n  «va justo»' }] }),
      'risks',
    )

    expect(markdown.split('\n').slice(2)).toEqual(['- Two lines — afecta a a date', '  > dijo: «va justo»'])
  })

  it('trims the text of an item', () => {
    expect(listMarkdown(insights({ openQuestions: [{ text: '  ¿y el precio?  ', evidence: '' }] }), 'openQuestions')).toBe(
      ['## Preguntas abiertas', '', '- ¿y el precio?'].join('\n'),
    )
  })

  it('leaves out an item with no text at all', () => {
    const markdown = listMarkdown(
      insights({ openQuestions: [{ text: '   ', evidence: 'esto no dice nada' }, QUESTION] }),
      'openQuestions',
    )

    expect(markdown.split('\n').slice(2)).toEqual([
      '- Who signs off on the pricing?',
      '  > ¿quién firma el precio final?',
    ])
  })

  // A lone heading pasted into a note reads as «this meeting decided nothing»,
  // which is a claim the empty list never made.
  it('answers nothing at all for an empty list', () => {
    expect(listMarkdown(insights(), 'decisions')).toBe('')
  })

  it('answers nothing at all when every item is blank', () => {
    expect(listMarkdown(insights({ risks: [{ text: '', affects: 'x', evidence: 'y' }] }), 'risks')).toBe('')
  })
})

describe('insightsMarkdown', () => {
  it('writes the three lists in reading order, separated by a blank line', () => {
    expect(insightsMarkdown(insights({ decisions: [DECIDED], risks: [RISK], openQuestions: [QUESTION] }))).toBe(
      [
        '## Decisiones',
        '',
        '- Ship the beta in September — decidido por Ana',
        '  > Ana: lo sacamos en septiembre, decidido.',
        '',
        '## Riesgos',
        '',
        '- The vendor may not deliver on time — afecta a the launch date',
        '  > Marta: el proveedor va con retraso.',
        '',
        '## Preguntas abiertas',
        '',
        '- Who signs off on the pricing?',
        '  > ¿quién firma el precio final?',
      ].join('\n'),
    )
  })

  // Exactly what the panel does with an empty list: it is not there.
  it('leaves out the lists that are empty', () => {
    expect(insightsMarkdown(insights({ risks: [RISK] }))).toBe(
      [
        '## Riesgos',
        '',
        '- The vendor may not deliver on time — afecta a the launch date',
        '  > Marta: el proveedor va con retraso.',
      ].join('\n'),
    )
  })

  it('answers nothing when nothing was extracted', () => {
    expect(insightsMarkdown(insights())).toBe('')
  })
})

describe('insightsCount', () => {
  it('adds up the three lists', () => {
    expect(insightsCount(insights({ decisions: [DECIDED], risks: [RISK, RISK], openQuestions: [QUESTION] }))).toBe(4)
  })

  it('counts nothing as nothing', () => {
    expect(insightsCount(insights())).toBe(0)
  })
})

describe('hasInsights', () => {
  it('is false when the three lists are empty', () => {
    expect(hasInsights(insights())).toBe(false)
  })

  it.each([
    ['decisions', insights({ decisions: [DECIDED] })],
    ['risks', insights({ risks: [RISK] })],
    ['openQuestions', insights({ openQuestions: [QUESTION] })],
  ])('is true when only %s has something', (_kind, value) => {
    expect(hasInsights(value)).toBe(true)
  })
})
