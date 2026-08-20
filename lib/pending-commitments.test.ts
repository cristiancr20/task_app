import { describe, expect, it } from 'vitest'

import type { IssueState, IssueStateType } from '@/lib/linear'
import { pendingCommitments, type PendingCommitmentsInput } from '@/lib/pending-commitments'
import type { HistoryEntry, HistoryIssue } from '@/lib/store'

const PROJECT = 'project-acme'

/** A created issue, named for nobody unless a test says otherwise. */
function issue(id: string, mentioned: string | null = null): HistoryIssue {
  return {
    id,
    identifier: `ENG-${id}`,
    url: `https://linear.app/acme/issue/ENG-${id}`,
    title: `Tarea ${id}`,
    mentioned,
  }
}

function entry(partial: Partial<HistoryEntry> & { issues: HistoryIssue[] }): HistoryEntry {
  return {
    pushedAt: '2026-08-01T10:00:00.000Z',
    teamId: 'team-1',
    projectId: PROJECT,
    ...partial,
  }
}

function state(id: string, stateType: IssueStateType = 'started'): IssueState {
  return {
    id,
    identifier: `ENG-${id}`,
    title: `Tarea ${id}`,
    url: `https://linear.app/acme/issue/ENG-${id}`,
    stateName: stateType === 'started' ? 'En curso' : stateType,
    stateType,
  }
}

/** The states of every id named, all of them open unless said otherwise. */
function statesOf(...states: IssueState[]): Record<string, IssueState> {
  return Object.fromEntries(states.map((it) => [it.id, it]))
}

function input(partial: Partial<PendingCommitmentsInput>): PendingCommitmentsInput {
  return {
    history: {},
    states: {},
    notePath: 'notas/2026-08-10-hoy.md',
    projectId: PROJECT,
    ...partial,
  }
}

describe('pendingCommitments', () => {
  it('answers nothing for an empty history', () => {
    expect(pendingCommitments(input({}))).toEqual([])
  })

  it('answers nothing when no project is selected, however much is open', () => {
    const history = { 'notas/2026-08-01-antes.md': [entry({ issues: [issue('1')] })] }

    expect(
      pendingCommitments(input({ history, states: statesOf(state('1')), projectId: null })),
    ).toEqual([])
  })

  it('answers nothing when the project is an empty string', () => {
    const history = { 'notas/2026-08-01-antes.md': [entry({ issues: [issue('1')] })] }

    expect(
      pendingCommitments(input({ history, states: statesOf(state('1')), projectId: '' })),
    ).toEqual([])
  })

  it('reports an open issue of a previous note with its path, title and push date', () => {
    const history = {
      'notas/2026-08-01-cierre-con-acme.md': [
        entry({ pushedAt: '2026-08-01T09:30:00.000Z', issues: [issue('1')] }),
      ],
    }

    expect(pendingCommitments(input({ history, states: statesOf(state('1')) }))).toEqual([
      {
        issue: state('1'),
        mentioned: null,
        notePath: 'notas/2026-08-01-cierre-con-acme.md',
        noteTitle: 'cierre con acme',
        pushedAt: '2026-08-01T09:30:00.000Z',
      },
    ])
  })

  describe('what counts as still open', () => {
    const open: IssueStateType[] = ['triage', 'backlog', 'unstarted', 'started']
    const closed: IssueStateType[] = ['completed', 'canceled']

    it.each(open)('keeps an issue in %s', (stateType) => {
      const history = { 'notas/antes.md': [entry({ issues: [issue('1')] })] }
      const result = pendingCommitments(input({ history, states: statesOf(state('1', stateType)) }))

      expect(result.map((it) => it.issue.id)).toEqual(['1'])
    })

    it.each(closed)('drops an issue in %s', (stateType) => {
      const history = { 'notas/antes.md': [entry({ issues: [issue('1')] })] }

      expect(
        pendingCommitments(input({ history, states: statesOf(state('1', stateType)) })),
      ).toEqual([])
    })

    it('drops an issue Linear said nothing about', () => {
      const history = { 'notas/antes.md': [entry({ issues: [issue('1'), issue('2')] })] }
      const result = pendingCommitments(input({ history, states: statesOf(state('2')) }))

      expect(result.map((it) => it.issue.id)).toEqual(['2'])
    })
  })

  describe('what counts as this project', () => {
    it('drops a push aimed at another project', () => {
      const history = {
        'notas/otro.md': [entry({ projectId: 'project-otro', issues: [issue('1')] })],
        'notas/acme.md': [entry({ issues: [issue('2')] })],
      }
      const result = pendingCommitments(
        input({ history, states: statesOf(state('1'), state('2')) }),
      )

      expect(result.map((it) => it.issue.id)).toEqual(['2'])
    })

    it('drops an old entry that never recorded a project', () => {
      const history = { 'notas/antes.md': [entry({ projectId: null, issues: [issue('1')] })] }

      expect(pendingCommitments(input({ history, states: statesOf(state('1')) }))).toEqual([])
    })

    it('reads a mixed history: only the pushes of this project come back', () => {
      const history = {
        // Written before the destination was recorded: `null` is «no consta».
        'notas/2026-07-01-vieja.md': [entry({ projectId: null, issues: [issue('1')] })],
        'notas/2026-07-15-otro-cliente.md': [
          entry({ projectId: 'project-otro', issues: [issue('2')] }),
        ],
        'notas/2026-08-01-acme.md': [
          entry({ projectId: null, issues: [issue('3')] }),
          entry({ pushedAt: '2026-08-02T10:00:00.000Z', issues: [issue('4')] }),
        ],
      }
      const result = pendingCommitments(
        input({
          history,
          states: statesOf(state('1'), state('2'), state('3'), state('4')),
        }),
      )

      expect(result.map((it) => it.issue.id)).toEqual(['4'])
    })
  })

  it('drops the issues of the note that is open', () => {
    const history = {
      'notas/2026-08-10-hoy.md': [entry({ issues: [issue('1')] })],
      'notas/2026-08-01-antes.md': [entry({ issues: [issue('2')] })],
    }
    const result = pendingCommitments(
      input({
        history,
        states: statesOf(state('1'), state('2')),
        notePath: 'notas/2026-08-10-hoy.md',
      }),
    )

    expect(result.map((it) => it.issue.id)).toEqual(['2'])
  })

  describe('order', () => {
    it('reads from the oldest push to the most recent, across notes', () => {
      const history = {
        'notas/b.md': [
          entry({ pushedAt: '2026-08-05T10:00:00.000Z', issues: [issue('3')] }),
          entry({ pushedAt: '2026-08-02T10:00:00.000Z', issues: [issue('2')] }),
        ],
        'notas/a.md': [entry({ pushedAt: '2026-07-20T10:00:00.000Z', issues: [issue('1')] })],
      }
      const result = pendingCommitments(
        input({ history, states: statesOf(state('1'), state('2'), state('3')) }),
      )

      expect(result.map((it) => it.issue.id)).toEqual(['1', '2', '3'])
    })

    it('keeps the order of the history for pushes made at the same instant', () => {
      const history = {
        'notas/a.md': [entry({ issues: [issue('1'), issue('2')] })],
        'notas/b.md': [entry({ issues: [issue('3')] })],
      }
      const result = pendingCommitments(
        input({ history, states: statesOf(state('1'), state('2'), state('3')) }),
      )

      expect(result.map((it) => it.issue.id)).toEqual(['1', '2', '3'])
    })

    it('lists an issue pushed twice once, under the oldest push that created it', () => {
      const history = {
        'notas/b.md': [entry({ pushedAt: '2026-08-05T10:00:00.000Z', issues: [issue('1')] })],
        'notas/a.md': [entry({ pushedAt: '2026-07-20T10:00:00.000Z', issues: [issue('1')] })],
      }
      const result = pendingCommitments(input({ history, states: statesOf(state('1')) }))

      expect(result).toEqual([
        {
          issue: state('1'),
          mentioned: null,
          notePath: 'notas/a.md',
          noteTitle: 'a',
          pushedAt: '2026-07-20T10:00:00.000Z',
        },
      ])
    })

    it('sorts a stamp that is not a date last rather than as the oldest', () => {
      const history = {
        'notas/rota.md': [entry({ pushedAt: 'ayer por la tarde', issues: [issue('1')] })],
        'notas/a.md': [entry({ pushedAt: '2026-08-02T10:00:00.000Z', issues: [issue('2')] })],
      }
      const result = pendingCommitments(
        input({ history, states: statesOf(state('1'), state('2')) }),
      )

      expect(result.map((it) => it.issue.id)).toEqual(['2', '1'])
    })
  })

  describe('the note each commitment came from', () => {
    it('uses the title the explorer already knows', () => {
      const history = { 'notas/2026-08-01-acme.md': [entry({ issues: [issue('1')] })] }
      const result = pendingCommitments(
        input({
          history,
          states: statesOf(state('1')),
          titles: { 'notas/2026-08-01-acme.md': 'Cierre trimestral con Acme' },
        }),
      )

      expect(result[0].noteTitle).toBe('Cierre trimestral con Acme')
    })

    it.each([
      ['notas/2026-08-01-cierre-con-acme.md', 'cierre con acme'],
      ['notas/kickoff_acme.md', 'kickoff acme'],
      ['kickoff.md', 'kickoff'],
      // Nothing but a date: the date is all there is to call it, as
      // `titleFromFileName` also reads it.
      ['notas/2026-08-01.md', '2026 08 01'],
    ])('falls back to the file name of %s', (path, expected) => {
      const history = { [path]: [entry({ issues: [issue('1')] })] }
      const result = pendingCommitments(input({ history, states: statesOf(state('1')) }))

      expect(result[0]).toMatchObject({ notePath: path, noteTitle: expected })
    })

    it('falls back for a note the titles do not name', () => {
      const history = { 'notas/otra-carpeta/kickoff.md': [entry({ issues: [issue('1')] })] }
      const result = pendingCommitments(
        input({ history, states: statesOf(state('1')), titles: { 'notas/acme.md': 'Acme' } }),
      )

      expect(result[0].noteTitle).toBe('kickoff')
    })
  })

  describe('who the transcript put in charge', () => {
    it('carries the name the note recorded with the issue', () => {
      const history = { 'notas/antes.md': [entry({ issues: [issue('1', 'Ana')] })] }
      const result = pendingCommitments(input({ history, states: statesOf(state('1')) }))

      expect(result[0].mentioned).toBe('Ana')
    })

    // Linear was never told who was named — the push does not assign anybody —
    // so the name can only come from the history, never from the live state.
    it('reads the name from the history and not from the reported state', () => {
      const history = { 'notas/antes.md': [entry({ issues: [issue('1', 'Ana')] })] }
      const result = pendingCommitments(
        input({ history, states: statesOf({ ...state('1'), title: 'Otro título' }) }),
      )

      expect(result[0]).toMatchObject({ mentioned: 'Ana', issue: { title: 'Otro título' } })
    })

    it('reads an issue nobody was named for as unknown', () => {
      const history = { 'notas/antes.md': [entry({ issues: [issue('1')] })] }
      const result = pendingCommitments(input({ history, states: statesOf(state('1')) }))

      expect(result[0].mentioned).toBeNull()
    })

    // The row that survives the dedup is the oldest push, so the name shown is
    // the one that push recorded — not whatever a later note said about it.
    it('keeps the name of the push it is listed under', () => {
      const history = {
        'notas/b.md': [
          entry({ pushedAt: '2026-08-05T10:00:00.000Z', issues: [issue('1', 'Beatriz')] }),
        ],
        'notas/a.md': [
          entry({ pushedAt: '2026-07-20T10:00:00.000Z', issues: [issue('1', 'Ana')] }),
        ],
      }
      const result = pendingCommitments(input({ history, states: statesOf(state('1')) }))

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ notePath: 'notas/a.md', mentioned: 'Ana' })
    })
  })

  it('reports the state Linear gave, not the title frozen in the history', () => {
    const history = { 'notas/antes.md': [entry({ issues: [issue('1')] })] }
    const renamed = { ...state('1'), title: 'Tarea renombrada en Linear', stateName: 'En revisión' }
    const result = pendingCommitments(input({ history, states: statesOf(renamed) }))

    expect(result[0].issue).toEqual(renamed)
  })

  it('ignores a note whose pushes created no issues', () => {
    const history = {
      'notas/vacia.md': [entry({ issues: [] })],
      'notas/antes.md': [entry({ issues: [issue('1')] })],
    }
    const result = pendingCommitments(input({ history, states: statesOf(state('1')) }))

    expect(result.map((it) => it.notePath)).toEqual(['notas/antes.md'])
  })
})
