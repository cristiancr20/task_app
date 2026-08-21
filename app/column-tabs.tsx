'use client'

import { useRef } from 'react'

import {
  type ColumnCounts,
  type ColumnTab,
  columnTabViews,
  edgeEnabledTab,
  nextEnabledTab,
} from '@/lib/column-tabs'

type Props = {
  /** What each tab holds right now — see `columnCounts`. */
  counts: ColumnCounts
  /** The tab last pressed. What is really open is decided by `columnTabViews`. */
  chosen: ColumnTab
  /**
   * A tab whose contents changed while another one was open — a push that just
   * landed in «Enviadas». It is dropped by `tabMarked` the moment that tab is
   * the one on screen, so the caller never has to clear it on a click.
   */
  marked?: ColumnTab | null
  onChange: (tab: ColumnTab) => void
}

const NUMBER = new Intl.NumberFormat('es-ES')

/** The ids the tabs and their panels point at each other with. */
export function columnTabId(tab: ColumnTab): string {
  return `column-tab-${tab}`
}

export function columnPanelId(tab: ColumnTab): string {
  return `column-panel-${tab}`
}

/**
 * The head of the tasks column: «Tareas», «La reunión» y «Enviadas», each with
 * the number of things behind it.
 *
 * It is a real tablist and not three buttons that look like one. The column
 * holds three piles that are never read at the same time, and the whole reason
 * they became tabs is that stacked they took the height away from the table —
 * so what a screen reader hears has to be the same fact the layout is built on:
 * one of three, this one open, that one empty.
 *
 * Everything it decides comes from `lib/column-tabs.ts`: the words, the
 * numbers, which tabs can be pressed, which one wears the «recién cambiada»
 * dot and where an arrow key lands. This file only draws it and moves the
 * focus, which is the half that cannot be a unit test — the arithmetic is.
 *
 * Keyboard, as the tablist pattern has it: one stop in the tab order (the open
 * tab), arrows to move — wrapping, skipping the disabled ones exactly like a
 * click does — and Inicio/Fin for the ends. Moving selects, because each panel
 * is already on screen and there is nothing to confirm.
 */
export function ColumnTabs({ counts, chosen, marked = null, onChange }: Props) {
  const buttons = useRef<Partial<Record<ColumnTab, HTMLButtonElement | null>>>({})
  const views = columnTabViews(counts, chosen, marked)
  const active = views.find((view) => view.active)?.tab ?? chosen

  // Selecting and focusing together: with a roving tabindex the tab that was
  // left behind is no longer a tab stop, so a move that only selected would
  // drop the keyboard out of the row it is walking.
  function move(tab: ColumnTab) {
    onChange(tab)
    buttons.current[tab]?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : null
    if (step) {
      event.preventDefault()
      move(nextEnabledTab(counts, active, step))
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      move(edgeEnabledTab(counts, event.key === 'Home' ? 'first' : 'last'))
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Qué mostrar de esta nota"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      /* The `panel-head` shape — recessed, ruled, 2.5 rem tall — written out
         rather than reused, because the tabs need their own padding and gap
         and a utility that sets both is not something to fight with. */
      className="flex min-h-10 shrink-0 items-center gap-1 border-b border-line bg-surface-2 px-1.5"
    >
      {views.map((view) => (
        <button
          key={view.tab}
          ref={(element) => {
            buttons.current[view.tab] = element
          }}
          type="button"
          role="tab"
          id={columnTabId(view.tab)}
          aria-selected={view.active}
          aria-controls={columnPanelId(view.tab)}
          /* One stop for the whole row: the open tab. A disabled tab is not a
             stop either way, and `activeTab` guarantees the open one is not
             disabled, so the row always has exactly one. */
          tabIndex={view.active ? 0 : -1}
          disabled={!view.enabled}
          title={view.title}
          onClick={() => onChange(view.tab)}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            view.active
              ? 'bg-surface text-content shadow-panel'
              : view.enabled
                ? 'text-muted hover:bg-line/50 hover:text-content'
                : 'cursor-not-allowed text-muted/50'
          }`}
        >
          {view.label}
          {/* The number is drawn for every tab, including a disabled `0`: what
              makes the tab unpressable is exactly what it says, and hiding it
              would leave the greying-out unexplained. */}
          <span
            className={`rounded px-1 text-[0.6875rem] tabular-nums ${
              view.active ? 'bg-line text-content' : 'text-muted/80'
            }`}
          >
            {NUMBER.format(view.count)}
          </span>
          {/* «Aquí ha pasado algo»: the send bar no longer prints what a push
              created, so this is what points at the pestaña that now holds it.
              A dot rather than another number — the count beside it has already
              gone up — and it says so out loud too, because a screen reader
              cannot see the column change under it. */}
          {view.marked ? (
            <>
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />
              <span className="sr-only">actualizada por el último envío</span>
            </>
          ) : null}
        </button>
      ))}
    </div>
  )
}
