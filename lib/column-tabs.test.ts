import { describe, expect, it } from 'vitest'

import {
  activeTab,
  COLUMN_TABS,
  type ColumnCounts,
  columnCounts,
  columnTabViews,
  DEFAULT_COLUMN_TAB,
  edgeEnabledTab,
  emptyColumnCounts,
  nextEnabledTab,
  tabCount,
  tabEnabled,
  tabLabel,
  tabMarked,
  tabTitle,
} from '@/lib/column-tabs'
import { emptyInsights, type MeetingInsights } from '@/lib/extractors/task'

/** Insights with `n` of each kind, which is all the count ever looks at. */
function insights(decisions: number, risks: number, questions: number): MeetingInsights {
  return {
    decisions: Array.from({ length: decisions }, (_, index) => ({
      text: `decisión ${index}`,
      decidedBy: null,
      evidence: '',
    })),
    risks: Array.from({ length: risks }, (_, index) => ({
      text: `riesgo ${index}`,
      affects: null,
      evidence: '',
    })),
    openQuestions: Array.from({ length: questions }, (_, index) => ({
      text: `pregunta ${index}`,
      evidence: '',
    })),
  }
}

function counts(tasks: number, meeting: number, sent: number): ColumnCounts {
  return { tasks, meeting, sent }
}

describe('COLUMN_TABS', () => {
  it('is what is being prepared, then its context, then its record', () => {
    expect(COLUMN_TABS).toEqual(['tasks', 'meeting', 'sent'])
  })

  it('opens on the table, which is the only tab that is edited', () => {
    expect(DEFAULT_COLUMN_TAB).toBe('tasks')
  })

  it('starts every column at zero', () => {
    expect(emptyColumnCounts()).toEqual({ tasks: 0, meeting: 0, sent: 0 })
  })
})

describe('columnCounts', () => {
  it('takes the table from the rows, whether they are checked or not', () => {
    const result = columnCounts({
      rows: 7,
      insights: emptyInsights(),
      commitments: 0,
      sent: 0,
    })

    expect(result.tasks).toBe(7)
  })

  it('adds the four things «La reunión» shows into one number', () => {
    const result = columnCounts({
      rows: 0,
      insights: insights(2, 1, 3),
      commitments: 4,
      sent: 0,
    })

    expect(result.meeting).toBe(10)
  })

  it('takes «Enviadas» from the list the panel draws — see `sentIssueCount`', () => {
    const result = columnCounts({
      rows: 0,
      insights: emptyInsights(),
      commitments: 0,
      sent: 3,
    })

    expect(result.sent).toBe(3)
  })

  it('opens «La reunión» on the commitments alone', () => {
    // The meeting itself left no decisions, risks or questions, but previous
    // ones left four issues open: the panel has something in it, so the tab
    // that opens onto it must not be the disabled one.
    const result = columnCounts({
      rows: 0,
      insights: emptyInsights(),
      commitments: 4,
      sent: 0,
    })

    expect(result.meeting).toBe(4)
    expect(tabEnabled(result, 'meeting')).toBe(true)
  })

  it('opens «La reunión» on the insights alone', () => {
    const result = columnCounts({
      rows: 0,
      insights: insights(1, 0, 0),
      commitments: 0,
      sent: 0,
    })

    expect(result.meeting).toBe(1)
    expect(tabEnabled(result, 'meeting')).toBe(true)
  })

  it('closes «La reunión» only when all four are empty', () => {
    const result = columnCounts({
      rows: 6,
      insights: emptyInsights(),
      commitments: 0,
      sent: 2,
    })

    expect(result.meeting).toBe(0)
    expect(tabEnabled(result, 'meeting')).toBe(false)
    expect(activeTab(result, 'meeting')).toBe('tasks')
  })

  it('is all zeros for a note with nothing at all', () => {
    expect(
      columnCounts({ rows: 0, insights: emptyInsights(), commitments: 0, sent: 0 }),
    ).toEqual(emptyColumnCounts())
  })

  it('reads each number off the counts by tab', () => {
    const result = counts(4, 2, 9)

    expect(tabCount(result, 'tasks')).toBe(4)
    expect(tabCount(result, 'meeting')).toBe(2)
    expect(tabCount(result, 'sent')).toBe(9)
  })
})

describe('tabEnabled', () => {
  it('keeps «Tareas» open with an empty table: it is where extraction starts', () => {
    expect(tabEnabled(counts(0, 0, 0), 'tasks')).toBe(true)
  })

  it('disables a report with nothing to report', () => {
    const empty = counts(3, 0, 0)

    expect(tabEnabled(empty, 'meeting')).toBe(false)
    expect(tabEnabled(empty, 'sent')).toBe(false)
  })

  it('enables each one as soon as it holds something', () => {
    expect(tabEnabled(counts(0, 1, 0), 'meeting')).toBe(true)
    expect(tabEnabled(counts(0, 0, 1), 'sent')).toBe(true)
  })
})

describe('tabLabel', () => {
  it('names the three piles', () => {
    expect(COLUMN_TABS.map(tabLabel)).toEqual(['Tareas', 'La reunión', 'Enviadas'])
  })
})

describe('tabTitle', () => {
  it('explains a disabled tab instead of leaving it greyed out in silence', () => {
    const empty = counts(0, 0, 0)

    expect(tabTitle(empty, 'meeting')).toMatch(/no dejó decisiones/)
    expect(tabTitle(empty, 'sent')).toMatch(/Todavía no se ha enviado/)
  })

  it('describes what the tab holds once it holds something', () => {
    const full = counts(2, 5, 3)

    expect(tabTitle(full, 'meeting')).toMatch(/Decisiones/)
    expect(tabTitle(full, 'sent')).toMatch(/ya creó en Linear/)
  })
})

describe('activeTab', () => {
  it('honours what was pressed while it still holds something', () => {
    expect(activeTab(counts(2, 4, 0), 'meeting')).toBe('meeting')
  })

  it('falls back to «Tareas» for a tab that has nothing behind it', () => {
    expect(activeTab(counts(2, 0, 0), 'meeting')).toBe('tasks')
    expect(activeTab(counts(2, 0, 0), 'sent')).toBe('tasks')
  })

  it('leaves a tab that empties underneath the user', () => {
    // The note was opened on its history and the drafts were re-extracted:
    // the counts change under the same choice, and the fallback is immediate.
    const chosen = 'sent'

    expect(activeTab(counts(0, 0, 4), chosen)).toBe('sent')
    expect(activeTab(counts(0, 0, 0), chosen)).toBe('tasks')
  })

  it('never leaves the column without a panel', () => {
    for (const tab of COLUMN_TABS) {
      expect(tabEnabled(emptyColumnCounts(), activeTab(emptyColumnCounts(), tab))).toBe(true)
    }
  })
})

describe('tabMarked', () => {
  it('marks the tab something landed in while another one was open', () => {
    expect(tabMarked(counts(3, 0, 2), 'tasks', 'sent', 'sent')).toBe(true)
  })

  it('never marks the tab that is on screen: it has already shown the news', () => {
    expect(tabMarked(counts(3, 0, 2), 'sent', 'sent', 'sent')).toBe(false)
  })

  it('never marks a tab that cannot be opened', () => {
    // The push wrote nothing, so «Enviadas» is still empty and still disabled:
    // a dot on it would point at a panel the user cannot reach.
    expect(tabMarked(counts(3, 0, 0), 'tasks', 'sent', 'sent')).toBe(false)
  })

  it('marks nothing when nothing changed', () => {
    for (const tab of COLUMN_TABS) {
      expect(tabMarked(counts(3, 2, 2), 'tasks', null, tab)).toBe(false)
    }
  })

  it('marks only the tab it is about', () => {
    const marked = COLUMN_TABS.filter((tab) => tabMarked(counts(3, 2, 2), 'tasks', 'sent', tab))

    expect(marked).toEqual(['sent'])
  })

  it('is dropped when the tab it points at becomes the open one by fallback', () => {
    // «Tareas» is chosen, and it is also where a mark on «Tareas» would sit —
    // the panel is on screen, so there is nothing to announce.
    expect(tabMarked(counts(0, 0, 0), 'meeting', 'tasks', 'tasks')).toBe(false)
  })
})

describe('columnTabViews', () => {
  it('draws the three tabs with their word, number and state', () => {
    expect(columnTabViews(counts(3, 2, 0), 'tasks')).toEqual([
      {
        tab: 'tasks',
        label: 'Tareas',
        title: tabTitle(counts(3, 2, 0), 'tasks'),
        count: 3,
        enabled: true,
        active: true,
        marked: false,
      },
      {
        tab: 'meeting',
        label: 'La reunión',
        title: tabTitle(counts(3, 2, 0), 'meeting'),
        count: 2,
        enabled: true,
        active: false,
        marked: false,
      },
      {
        tab: 'sent',
        label: 'Enviadas',
        title: tabTitle(counts(3, 2, 0), 'sent'),
        count: 0,
        enabled: false,
        active: false,
        marked: false,
      },
    ])
  })

  it('carries the mark of the tab that just changed, and only that one', () => {
    const views = columnTabViews(counts(3, 0, 2), 'tasks', 'sent')

    expect(views.filter((view) => view.marked).map((view) => view.tab)).toEqual(['sent'])
  })

  it('marks nothing when no tab is pointed at', () => {
    expect(columnTabViews(counts(3, 2, 2), 'tasks').some((view) => view.marked)).toBe(false)
  })

  it('marks exactly one tab active, and it is one that can be opened', () => {
    const views = columnTabViews(counts(0, 0, 0), 'meeting')
    const active = views.filter((view) => view.active)

    expect(active).toHaveLength(1)
    expect(active[0]?.tab).toBe('tasks')
    expect(active[0]?.enabled).toBe(true)
  })
})

describe('nextEnabledTab', () => {
  it('walks right and wraps', () => {
    const all = counts(1, 1, 1)

    expect(nextEnabledTab(all, 'tasks', 1)).toBe('meeting')
    expect(nextEnabledTab(all, 'meeting', 1)).toBe('sent')
    expect(nextEnabledTab(all, 'sent', 1)).toBe('tasks')
  })

  it('walks left and wraps', () => {
    const all = counts(1, 1, 1)

    expect(nextEnabledTab(all, 'tasks', -1)).toBe('sent')
    expect(nextEnabledTab(all, 'sent', -1)).toBe('meeting')
    expect(nextEnabledTab(all, 'meeting', -1)).toBe('tasks')
  })

  it('skips a tab the mouse cannot reach either', () => {
    const noMeeting = counts(1, 0, 2)

    expect(nextEnabledTab(noMeeting, 'tasks', 1)).toBe('sent')
    expect(nextEnabledTab(noMeeting, 'sent', -1)).toBe('tasks')
  })

  it('stays put when it is the only tab that can be opened', () => {
    expect(nextEnabledTab(emptyColumnCounts(), 'tasks', 1)).toBe('tasks')
    expect(nextEnabledTab(emptyColumnCounts(), 'tasks', -1)).toBe('tasks')
  })
})

describe('edgeEnabledTab', () => {
  it('answers the ends of the row', () => {
    const all = counts(1, 1, 1)

    expect(edgeEnabledTab(all, 'first')).toBe('tasks')
    expect(edgeEnabledTab(all, 'last')).toBe('sent')
  })

  it('answers the ends of what is enabled, not of the row', () => {
    const noSent = counts(1, 3, 0)

    expect(edgeEnabledTab(noSent, 'last')).toBe('meeting')
  })

  it('is the default tab when nothing else can be opened', () => {
    expect(edgeEnabledTab(emptyColumnCounts(), 'last')).toBe('tasks')
  })
})
