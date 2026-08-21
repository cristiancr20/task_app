import { describe, expect, it } from 'vitest'

import type { PushedIssue } from '@/lib/push-events'
import { NO_SENT_RUN, sentIssueCount, sentIssueIds, sentPushes } from '@/lib/sent-issues'
import type { HistoryEntry } from '@/lib/store'

function issue(id: string): PushedIssue {
  return {
    id,
    identifier: `PLA-${id}`,
    url: `https://linear.app/${id}`,
    title: `Tarea ${id}`,
  }
}

/** One recorded push of the given issues. */
function entry(pushedAt: string, ids: string[]): HistoryEntry {
  return {
    pushedAt,
    teamId: 'team',
    projectId: 'project',
    issues: ids.map((id) => ({ ...issue(id), mentioned: null })),
  }
}

describe('sentPushes', () => {
  it('has nothing to show for a note that was never pushed', () => {
    expect(sentPushes([], NO_SENT_RUN)).toEqual([])
  })

  it('shows the record newest first, with every issue linked', () => {
    const pushes = sentPushes(
      [entry('2026-06-01T10:00:00.000Z', ['a']), entry('2026-06-02T10:00:00.000Z', ['b', 'c'])],
      NO_SENT_RUN,
    )

    expect(pushes.map((push) => push.pushedAt)).toEqual([
      '2026-06-02T10:00:00.000Z',
      '2026-06-01T10:00:00.000Z',
    ])
    expect(pushes[0]?.issues).toEqual([
      { ...issue('b'), parent: false, fresh: false },
      { ...issue('c'), parent: false, fresh: false },
    ])
  })

  it('puts the run that just finished first, dated as not yet recorded', () => {
    const pushes = sentPushes([entry('2026-06-01T10:00:00.000Z', ['a'])], {
      parentIssue: issue('p'),
      issues: [issue('b')],
    })

    expect(pushes[0]?.pushedAt).toBeNull()
    // The parent leads: it is the issue the rest hang from.
    expect(pushes[0]?.issues.map((sent) => sent.id)).toEqual(['p', 'b'])
    expect(pushes[0]?.issues.every((sent) => sent.fresh)).toBe(true)
    expect(pushes[1]?.pushedAt).toBe('2026-06-01T10:00:00.000Z')
  })

  it('drops a run issue the history already records, so nothing is counted twice', () => {
    const pushes = sentPushes([entry('2026-06-02T10:00:00.000Z', ['p', 'b'])], {
      parentIssue: issue('p'),
      issues: [issue('b')],
    })

    expect(pushes).toHaveLength(1)
    expect(sentIssueCount(pushes)).toBe(2)
    expect(pushes[0]?.issues.every((sent) => sent.fresh)).toBe(false)
  })

  it('keeps only what the history has not caught up with yet', () => {
    const pushes = sentPushes([entry('2026-06-02T10:00:00.000Z', ['b'])], {
      parentIssue: null,
      issues: [issue('b'), issue('c')],
    })

    expect(pushes[0]?.issues.map((sent) => sent.id)).toEqual(['c'])
    expect(sentIssueCount(pushes)).toBe(2)
  })

  it('marks the parent wherever it is, recorded or not', () => {
    const recorded = sentPushes([entry('2026-06-02T10:00:00.000Z', ['p', 'b'])], {
      parentIssue: issue('p'),
      issues: [issue('b')],
    })
    expect(recorded[0]?.issues.map((sent) => sent.parent)).toEqual([true, false])

    const justCreated = sentPushes([], {
      parentIssue: issue('p'),
      issues: [issue('b')],
    })
    expect(justCreated[0]?.issues.map((sent) => sent.parent)).toEqual([true, false])
  })

  it('marks no parent when the run created none', () => {
    const pushes = sentPushes([entry('2026-06-02T10:00:00.000Z', ['a', 'b'])], NO_SENT_RUN)

    expect(pushes[0]?.issues.some((sent) => sent.parent)).toBe(false)
  })
})

describe('sentIssueCount', () => {
  it('counts issues and not pushes', () => {
    const pushes = sentPushes(
      [entry('2026-06-01T10:00:00.000Z', ['a']), entry('2026-06-02T10:00:00.000Z', ['b', 'c'])],
      NO_SENT_RUN,
    )

    expect(sentIssueCount(pushes)).toBe(3)
  })

  it('counts a run the history has not recorded yet', () => {
    expect(sentIssueCount(sentPushes([], { parentIssue: issue('p'), issues: [issue('b')] }))).toBe(
      2,
    )
  })

  it('is zero for a note with nothing sent', () => {
    expect(sentIssueCount(sentPushes([], NO_SENT_RUN))).toBe(0)
  })
})

describe('sentIssueIds', () => {
  it('names every issue on screen, freshly created ones included', () => {
    const pushes = sentPushes([entry('2026-06-01T10:00:00.000Z', ['a'])], {
      parentIssue: issue('p'),
      issues: [issue('b')],
    })

    expect(sentIssueIds(pushes)).toEqual(['p', 'b', 'a'])
  })
})
