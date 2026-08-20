import { describe, expect, it } from 'vitest'

import type { IssueState, IssueStateType } from '@/lib/linear'
import { pushedProgress } from '@/lib/pushed-progress'

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

describe('pushedProgress', () => {
  it('counts the issues that are done or cancelled as closed', () => {
    const states = [
      state({ id: '1', stateType: 'completed' }),
      state({ id: '2', stateType: 'canceled' }),
      state({ id: '3', stateType: 'started' }),
      state({ id: '4', stateType: 'unstarted' }),
    ]

    expect(pushedProgress(4, states)).toEqual({ closed: 2, total: 4, done: false })
  })

  const open: IssueStateType[] = ['triage', 'backlog', 'unstarted', 'started']

  it.each(open)('leaves an issue in %s open', (stateType) => {
    expect(pushedProgress(1, [state({ id: '1', stateType })])).toEqual({
      closed: 0,
      total: 1,
      done: false,
    })
  })

  it('marks a note whose every task is closed as done', () => {
    const states = [
      state({ id: '1', stateType: 'completed' }),
      state({ id: '2', stateType: 'canceled' }),
    ]

    expect(pushedProgress(2, states)).toEqual({ closed: 2, total: 2, done: true })
  })

  // The history of a note pushed twice carries the same issue twice, and Linear
  // answers for it once: counting the copy would close a note that is not.
  it('counts a repeated issue once', () => {
    const states = [
      state({ id: '1', stateType: 'completed' }),
      state({ id: '1', stateType: 'completed' }),
    ]

    expect(pushedProgress(2, states)).toEqual({ closed: 1, total: 2, done: false })
  })

  // The denominator is what the row already showed, so a late answer completes
  // the badge instead of rewriting it.
  it('keeps the history as the denominator', () => {
    expect(pushedProgress(5, [state({ id: '1', stateType: 'completed' })])).toEqual({
      closed: 1,
      total: 5,
      done: false,
    })
  })

  // Linear no longer knows two of the five: they cannot be closed, and the note
  // reads as pending rather than as finished.
  it('never reads a note as done when the report is short of its history', () => {
    const states = [
      state({ id: '1', stateType: 'completed' }),
      state({ id: '2', stateType: 'completed' }),
      state({ id: '3', stateType: 'completed' }),
    ]

    expect(pushedProgress(5, states)).toEqual({ closed: 3, total: 5, done: false })
  })

  // A report longer than the history could only come from a corrupt history;
  // «7 de 5» is not a thing a badge may say.
  it('never counts more closed issues than the note created', () => {
    const states = [
      state({ id: '1', stateType: 'completed' }),
      state({ id: '2', stateType: 'completed' }),
      state({ id: '3', stateType: 'completed' }),
    ]

    expect(pushedProgress(2, states)).toEqual({ closed: 2, total: 2, done: true })
  })

  it('says nothing while there is no report', () => {
    expect(pushedProgress(3, undefined)).toBeNull()
  })

  // Linear knows none of the note's issues — every number would be a claim
  // about issues nobody can open.
  it('says nothing when the report is empty', () => {
    expect(pushedProgress(3, [])).toBeNull()
  })

  it('says nothing about a note that created nothing', () => {
    expect(pushedProgress(0, [state({ id: '1', stateType: 'completed' })])).toBeNull()
  })
})
