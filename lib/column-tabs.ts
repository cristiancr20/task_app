/**
 * Which pestaña of the tasks column is on screen, as pure logic.
 *
 * The Linear column had grown into five blocks stacked on top of each other —
 * the round, the destination, the push history, the pending commitments, the
 * table and the insights — all competing for the same height, with the only
 * one the user *edits* squeezed in the middle. This splits them into three
 * piles that are never needed at the same time: what is being prepared
 * («Tareas»), what the meeting knew and what previous ones left open («La
 * reunión»), and what this note already produced in Linear («Enviadas»).
 *
 * Everything the header has to decide lives here rather than in the component
 * or the hook: which tabs exist, what each one says, what number it shows, and
 * whether it can be opened at all. A tab with nothing behind it is *disabled*
 * — opening onto an empty panel is a promise the column cannot keep — and
 * because that rule is arithmetic over the counts, the same function answers
 * «which tab is really open» when the one that was chosen goes empty
 * underneath the user (a push lands, an extraction replaces the insights).
 *
 * `tasks` is the exception and is always enabled: an empty table is not an
 * empty panel, it is where the extraction is launched from, so disabling it
 * would take away the only way to fill any of the other two.
 *
 * Nothing here reads the filesystem, imports React or knows about the push;
 * the two `import type`s are shapes, so this module stays in the browser
 * bundle without dragging `node:fs` behind it.
 */

import type { MeetingInsights } from './extractors/task'
import { insightsCount } from './insights-markdown'

/** The three piles the column splits into. */
export type ColumnTab = 'tasks' | 'meeting' | 'sent'

/** In the order they are drawn: what is being prepared, its context, its record. */
export const COLUMN_TABS: readonly ColumnTab[] = ['tasks', 'meeting', 'sent']

/**
 * The tab a note opens on.
 *
 * It belongs to the session and not to the note — see `activeTab` — because
 * the answer to «what am I doing here» is the same for every note being worked
 * through: reviewing its tasks. Remembering a tab per path would mean coming
 * back to a reading panel on a note that was opened to be sent.
 */
export const DEFAULT_COLUMN_TAB: ColumnTab = 'tasks'

/** What each tab holds right now. Zero is what disables one. */
export type ColumnCounts = Record<ColumnTab, number>

/** What the counts are computed from: one number per thing the column draws. */
export type ColumnContent = {
  /** Rows of the task table, checked or not — the table draws them all. */
  rows: number
  /** The three lists the same extraction produced beside the rows. */
  insights: MeetingInsights
  /** What previous meetings of this project left open — see `pendingCommitments`. */
  commitments: number
  /**
   * Issues this note has created in Linear: the pushes on record plus the run
   * that has just finished — `sentIssueCount`, which is the very list the
   * pestaña draws, so the number and the panel cannot disagree.
   */
  sent: number
}

/**
 * The number on each tab.
 *
 * «La reunión» adds the four things it shows — decisions, risks, open
 * questions and the commitments of previous meetings — because they are one
 * panel: a tab that counted only the insights would read `0` over a panel
 * holding six commitments, and be disabled over a panel that has something in
 * it, which is the one thing the disabled rule must never do.
 */
export function columnCounts(content: ColumnContent): ColumnCounts {
  return {
    tasks: content.rows,
    meeting: insightsCount(content.insights) + content.commitments,
    sent: content.sent,
  }
}

/** Counts for a column with no note open, so the header can be drawn anyway. */
export function emptyColumnCounts(): ColumnCounts {
  return { tasks: 0, meeting: 0, sent: 0 }
}

/** How many the tab shows. */
export function tabCount(counts: ColumnCounts, tab: ColumnTab): number {
  return counts[tab]
}

/**
 * Whether the tab can be opened.
 *
 * `tasks` is always open: an empty table is the state a note starts in and it
 * carries the «Extraer tareas» button, so it is a panel with something to do
 * rather than an empty one. The other two are pure reports — with nothing to
 * report there is nothing to show, and a tab that opens onto a blank panel is
 * worse than one that says, by being disabled, that there is nothing there.
 */
export function tabEnabled(counts: ColumnCounts, tab: ColumnTab): boolean {
  return tab === DEFAULT_COLUMN_TAB || counts[tab] > 0
}

/** What the tab says. */
export function tabLabel(tab: ColumnTab): string {
  switch (tab) {
    case 'tasks':
      return 'Tareas'
    case 'meeting':
      return 'La reunión'
    case 'sent':
      return 'Enviadas'
  }
}

/** The tab, spelled out: its title, and what it holds when it holds nothing. */
export function tabTitle(counts: ColumnCounts, tab: ColumnTab): string {
  if (!tabEnabled(counts, tab)) return tabEmptyTitle(tab)

  switch (tab) {
    case 'tasks':
      return 'Las tareas extraídas de esta nota'
    case 'meeting':
      return 'Decisiones, riesgos, preguntas abiertas y lo que dejaron pendiente reuniones anteriores'
    case 'sent':
      return 'Lo que esta nota ya creó en Linear'
  }
}

/**
 * Why a tab is disabled, in the words the user needs to make it stop being
 * disabled. A greyed-out control with no explanation reads as broken.
 */
export function tabEmptyTitle(tab: ColumnTab): string {
  switch (tab) {
    case 'tasks':
      return 'Las tareas extraídas de esta nota'
    case 'meeting':
      return 'Esta reunión no dejó decisiones, riesgos ni preguntas, y no hay nada pendiente de reuniones anteriores'
    case 'sent':
      return 'Todavía no se ha enviado nada de esta nota a Linear'
  }
}

/**
 * The tab that is really open.
 *
 * `chosen` is what the user last pressed, and it is only honoured while it
 * still has something behind it: an extraction that returns no insights, or a
 * history that is still loading, can empty the open tab after it was opened.
 * Falling back here — in the render, out of the counts — is what keeps «una
 * pestaña sin nada que mostrar nunca es la pestaña inicial» true at every
 * moment and not only on the first paint, without an effect that would draw
 * the empty panel once before correcting itself.
 */
export function activeTab(counts: ColumnCounts, chosen: ColumnTab): ColumnTab {
  return tabEnabled(counts, chosen) ? chosen : DEFAULT_COLUMN_TAB
}

/**
 * Whether the tab has to say that what it holds changed while another one was
 * open.
 *
 * It is what replaces the list of created issues the send bar used to print:
 * the push no longer answers itself where the button is, so the column has to
 * point at the pestaña that now holds the answer. The mark is therefore only
 * ever worn by a tab the user is *not* looking at — an open panel has already
 * shown the news — and never by a disabled one, which would be a promise of
 * something behind a tab that cannot be pressed.
 */
export function tabMarked(
  counts: ColumnCounts,
  chosen: ColumnTab,
  marked: ColumnTab | null,
  tab: ColumnTab,
): boolean {
  return marked === tab && tabEnabled(counts, tab) && activeTab(counts, chosen) !== tab
}

/** One tab, as the header draws it. */
export type ColumnTabView = {
  tab: ColumnTab
  label: string
  title: string
  count: number
  enabled: boolean
  active: boolean
  /** Something landed in this tab while another was open — see `tabMarked`. */
  marked: boolean
}

/**
 * The whole header, in one pass: every tab with its word, its number, whether
 * it can be pressed, whether it is the one open and whether it has just
 * changed. The component maps over this instead of asking five questions per
 * tab, so «cuál está activa» is decided once rather than per element.
 */
export function columnTabViews(
  counts: ColumnCounts,
  chosen: ColumnTab,
  marked: ColumnTab | null = null,
): ColumnTabView[] {
  const active = activeTab(counts, chosen)

  return COLUMN_TABS.map((tab) => ({
    tab,
    label: tabLabel(tab),
    title: tabTitle(counts, tab),
    count: tabCount(counts, tab),
    enabled: tabEnabled(counts, tab),
    active: tab === active,
    marked: tabMarked(counts, chosen, marked, tab),
  }))
}

/**
 * The tab an arrow key moves to: the next enabled one in `step`'s direction,
 * wrapping, and `from` itself when it is the only one that can be opened.
 *
 * Wrapping rather than stopping at the ends is what a tablist does, and
 * skipping the disabled ones is the same rule as the click: a keyboard must
 * not be able to reach a state the mouse cannot.
 */
export function nextEnabledTab(
  counts: ColumnCounts,
  from: ColumnTab,
  step: 1 | -1,
): ColumnTab {
  const start = COLUMN_TABS.indexOf(from)
  const total = COLUMN_TABS.length

  for (let offset = 1; offset < total; offset += 1) {
    const candidate = COLUMN_TABS[(((start + step * offset) % total) + total) % total]
    if (tabEnabled(counts, candidate)) return candidate
  }

  return from
}

/** The first tab that can be opened, and the last — Inicio and Fin. */
export function edgeEnabledTab(counts: ColumnCounts, edge: 'first' | 'last'): ColumnTab {
  const enabled = COLUMN_TABS.filter((tab) => tabEnabled(counts, tab))
  const tab = edge === 'first' ? enabled[0] : enabled[enabled.length - 1]
  return tab ?? DEFAULT_COLUMN_TAB
}
