import { describe, expect, it } from 'vitest'

import {
  groupOfStateType,
  ISSUE_STATE_GROUPS,
  type IssueStateGroup,
  issueStatesById,
  summarizeIssueStates,
} from '@/lib/issue-state-summary'
import type { IssueState, IssueStateType } from '@/lib/linear'

function state(partial: Partial<IssueState> & { id: string }): IssueState {
  return {
    identifier: `ENG-${partial.id}`,
    title: `Tarea ${partial.id}`,
    url: `https://linear.app/acme/issue/ENG-${partial.id}`,
    stateName: 'Todo',
    stateType: 'unstarted',
    ...partial,
  }
}

const EMPTY = { completed: 0, started: 0, unstarted: 0, canceled: 0, total: 0 }

describe('groupOfStateType', () => {
  const cases: [IssueStateType, IssueStateGroup][] = [
    ['completed', 'completed'],
    ['started', 'started'],
    ['canceled', 'canceled'],
    ['unstarted', 'unstarted'],
    ['backlog', 'unstarted'],
    ['triage', 'unstarted'],
  ]

  it.each(cases)('reads %s as %s', (type, group) => {
    expect(groupOfStateType(type)).toBe(group)
  })

  it('only ever answers one of the four groups', () => {
    for (const [type] of cases) {
      expect(ISSUE_STATE_GROUPS).toContain(groupOfStateType(type))
    }
  })
})

describe('summarizeIssueStates', () => {
  it('counts nothing for an empty report', () => {
    expect(summarizeIssueStates([])).toEqual(EMPTY)
  })

  it('counts each issue in its own group', () => {
    const states = [
      state({ id: '1', stateType: 'completed' }),
      state({ id: '2', stateType: 'completed' }),
      state({ id: '3', stateType: 'started' }),
      state({ id: '4', stateType: 'unstarted' }),
      state({ id: '5', stateType: 'canceled' }),
    ]

    expect(summarizeIssueStates(states)).toEqual({
      completed: 2,
      started: 1,
      unstarted: 1,
      canceled: 1,
      total: 5,
    })
  })

  it('folds triage and backlog into «sin empezar»', () => {
    const states = [
      state({ id: '1', stateType: 'triage' }),
      state({ id: '2', stateType: 'backlog' }),
      state({ id: '3', stateType: 'unstarted' }),
    ]

    expect(summarizeIssueStates(states)).toEqual({ ...EMPTY, unstarted: 3, total: 3 })
  })

  it('does not care what the workspace named its states', () => {
    const states = [
      state({ id: '1', stateName: 'Enviado a producción', stateType: 'completed' }),
      state({ id: '2', stateName: 'Done', stateType: 'completed' }),
    ]

    expect(summarizeIssueStates(states)).toEqual({ ...EMPTY, completed: 2, total: 2 })
  })

  it('counts a repeated id once, with its first answer', () => {
    const states = [
      state({ id: '1', stateType: 'started' }),
      state({ id: '1', stateType: 'completed' }),
      state({ id: '2', stateType: 'completed' }),
    ]

    expect(summarizeIssueStates(states)).toEqual({
      ...EMPTY,
      started: 1,
      completed: 1,
      total: 2,
    })
  })

  it('reports the size of the answer, not of the history', () => {
    // Two issues of a three-issue note; the third is one Linear no longer
    // knows about, so it is in no group at all.
    const summary = summarizeIssueStates([
      state({ id: '1', stateType: 'completed' }),
      state({ id: '2', stateType: 'started' }),
    ])

    expect(summary.total).toBe(2)
    expect(summary.completed + summary.started + summary.unstarted + summary.canceled).toBe(
      summary.total,
    )
  })

  it('does not mutate the report it was given', () => {
    const states = [state({ id: '1', stateType: 'completed' })]
    const before = structuredClone(states)

    summarizeIssueStates(states)

    expect(states).toEqual(before)
  })

  it('answers the same thing twice for the same report', () => {
    const states = [state({ id: '1', stateType: 'completed' }), state({ id: '2' })]

    expect(summarizeIssueStates(states)).toEqual(summarizeIssueStates(states))
  })
})

describe('issueStatesById', () => {
  it('keys the report by issue id', () => {
    const done = state({ id: '1', stateType: 'completed' })
    const doing = state({ id: '2', stateType: 'started' })

    expect(issueStatesById([done, doing])).toEqual({ '1': done, '2': doing })
  })

  it('is empty for an empty report', () => {
    expect(issueStatesById([])).toEqual({})
  })

  it('keeps the first answer of a repeated id, the one that was counted', () => {
    const first = state({ id: '1', stateName: 'In Progress', stateType: 'started' })
    const second = state({ id: '1', stateName: 'Done', stateType: 'completed' })

    expect(issueStatesById([first, second])['1']).toBe(first)
  })

  it('has nothing to say about an issue that was not reported', () => {
    expect(issueStatesById([state({ id: '1' })])['missing']).toBeUndefined()
  })
})
