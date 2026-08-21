'use client'

import {
  groupOfStateType,
  ISSUE_STATE_GROUPS,
  type IssueStateGroup,
} from '@/lib/issue-state-summary'
import type { SentIssue, SentPush } from '@/lib/sent-issues'

import { StateDot } from './issue-state-dot'
import type { IssueStatesApi } from './use-issue-states'

type Props = {
  /** Every push of this note, newest first — see `sentPushes`. Never empty. */
  pushes: SentPush[]
  /** How many issues that is, counted once — see `sentIssueCount`. */
  total: number
  /** What Linear says about those issues today — see `useIssueStates`. */
  states: IssueStatesApi
}

const NUMBER = new Intl.NumberFormat('es-ES')
const DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' })

/** «3 hechas», in the four words the summary is read in. */
const GROUP_LABELS: Record<IssueStateGroup, string> = {
  completed: 'hechas',
  started: 'en curso',
  unstarted: 'sin empezar',
  canceled: 'canceladas',
}

/**
 * «Enviadas»: everything this note has produced in Linear — how many, when,
 * what became of each one, and a link to it.
 *
 * It is the whole of the pestaña, and it is the only place the column says
 * this. The send bar used to print its own list of created issues when a run
 * finished, so the same links were read twice in the same column and the two
 * lists disagreed about what «lo que produjo esta nota» meant: one knew only
 * about the last run, the other only about what had been written to disk.
 * `sentPushes` merges them before they get here — a run that has just finished
 * leads the list as «hace un momento» until the note re-reads its history —
 * so what the bar had to say is in this panel and nowhere else.
 *
 * Pushes are shown newest first, since the last one explains the current state
 * of the file. Nothing caps or scrolls inside: the pestaña is one scrolling
 * panel and a second scroll area halfway down it would only trap the wheel.
 *
 * The states are an addition to the record and never a replacement for it:
 * while they load, when there is no key to load them with, and when the query
 * fails, every line below is exactly what it was before — the report is what
 * is missing, not the fact that the issues were created.
 */
export function PushedHistory({ pushes, total, states }: Props) {
  const latest = pushes[0]

  return (
    <div className="flex min-h-0 flex-col">
      {/* The summary rides at the top of the panel, on the wash that has always
          meant «esto ya está hecho», with the record itself below it on the
          plain surface where the links are read. */}
      <div className="shrink-0 border-b border-line bg-warn-wash px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-warn">
          <Tick />
          {total === 1 ? '1 tarea ya creada' : `${NUMBER.format(total)} tareas ya creadas`}
          <span className="font-normal text-muted">
            {pushes.length > 1
              ? `· ${pushes.length} envíos, el último, ${whenLabel(latest?.pushedAt ?? null)}`
              : `· ${whenLabel(latest?.pushedAt ?? null)}`}
          </span>
        </p>

        <StateReport states={states} />
      </div>

      <div className="flex flex-col gap-2 px-3 py-2.5">
        {pushes.map((push, key) => (
          <div key={key}>
            {/* With a single push the date is already in the line above. */}
            {pushes.length > 1 ? (
              <p className="text-[0.6875rem] text-muted">{capitalise(whenLabel(push.pushedAt))}</p>
            ) : null}
            <ul className="flex flex-col gap-1">
              {push.issues.map((issue) => (
                <IssueLine key={issue.id} issue={issue} states={states} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One created issue: its identifier, its title, its state in Linear and a link
 * to it.
 *
 * The parent says so. It is the issue that stands for the meeting and the one
 * the rest hang from, so «cuál abro para ver la reunión entera» has to be
 * answerable here — it was the one thing the send bar's list said that the
 * record on disk does not, since a parent is stored like any other issue.
 */
function IssueLine({ issue, states }: { issue: SentIssue; states: IssueStatesApi }) {
  const state = states.byId[issue.id]

  return (
    <li>
      <a
        href={issue.url}
        target="_blank"
        rel="noreferrer noopener"
        title={`${issue.identifier} · ${issue.title}${state ? ` · ${state.stateName}` : ''}`}
        className="group flex items-baseline gap-1.5 text-xs text-content transition-colors hover:text-warn"
      >
        <span className="shrink-0 rounded border border-warn/30 px-1 font-mono text-[0.6875rem] text-warn">
          {issue.identifier}
        </span>
        <span className="truncate underline decoration-transparent underline-offset-2 transition-colors group-hover:decoration-current">
          {issue.title}
        </span>
        {issue.parent ? <span className="shrink-0 text-muted">(tarea padre)</span> : null}
        {/* Linear's own wording for the state, not ours: the workspace named
            its columns, and «Listo para QA» says more to whoever runs the
            meeting than «en curso». */}
        {state ? (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted">
            <StateDot group={groupOfStateType(state.stateType)} />
            {state.stateName}
          </span>
        ) : null}
      </a>
    </li>
  )
}

/**
 * The one line that answers «¿hay que insistir en algo?»: how many of the
 * meeting's tasks are done, moving, untouched or dropped.
 *
 * A group nobody is in is not printed — «0 canceladas» is noise on the four
 * notes out of five where nothing was cancelled. A failure is a notice with a
 * «Reintentar» rather than an alert: the history under it is intact and still
 * useful, and the states are the part that is missing.
 *
 * The counters bring their own «Actualizar» because the cycle behind them is
 * deliberately unhurried and stops with the tab: somebody who has just moved a
 * card in Linear and switched back should not have to guess how long the wait
 * is. When a refresh fails, the counters stay and say so in three words — they
 * are still true, they are just no longer known to be current.
 */
function StateReport({ states }: { states: IssueStatesApi }) {
  if (states.status === 'unavailable') return null

  if (states.status === 'error') {
    return (
      <p aria-live="polite" className="mt-1.5 flex items-center gap-1.5 text-[0.6875rem] text-muted">
        <span className="min-w-0 truncate">
          {states.error ?? 'No se pudo consultar el estado en Linear.'}
        </span>
        <button
          type="button"
          onClick={states.refresh}
          className="shrink-0 underline underline-offset-2 hover:text-content"
        >
          Reintentar
        </button>
      </p>
    )
  }

  const summary = states.summary

  if (states.status === 'loading' || !summary) {
    return (
      <p aria-live="polite" className="mt-1.5 text-[0.6875rem] text-muted">
        Consultando el estado en Linear…
      </p>
    )
  }

  // Linear knows none of these issues any more — they were deleted, or the key
  // now points at another workspace. Saying «0 hechas» would be a claim about
  // them; saying nothing leaves the history to speak for itself.
  if (summary.total === 0) return null

  return (
    <div className="mt-1.5 flex items-center gap-x-2.5">
      {/* The counters are the live region and the button is deliberately
          outside it: its label flips to «Actualizando…» on every background
          round, and a screen reader should hear the news, not the polling. */}
      <p aria-live="polite" className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        {ISSUE_STATE_GROUPS.filter((group) => summary[group] > 0).map((group) => (
          <span key={group} className="flex items-center gap-1 text-[0.6875rem] text-muted">
            <StateDot group={group} />
            <span className="font-medium text-content tabular-nums">{summary[group]}</span>
            {GROUP_LABELS[group]}
          </span>
        ))}
        {states.refreshError ? (
          <span title={states.refreshError} className="text-[0.6875rem] text-muted">
            · sin actualizar
          </span>
        ) : null}
      </p>
      <button
        type="button"
        onClick={states.refresh}
        disabled={states.refreshing}
        className="ml-auto shrink-0 text-[0.6875rem] text-muted underline underline-offset-2 transition-colors hover:text-content disabled:no-underline disabled:opacity-60"
      >
        {states.refreshing ? 'Actualizando…' : 'Actualizar'}
      </button>
    </div>
  )
}

function Tick() {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center rounded-full bg-warn/15"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-2.5"
      >
        <path d="m3.5 8.5 3 3 6-6.5" />
      </svg>
    </span>
  )
}

/**
 * When a push happened. A run that has just finished has no timestamp yet —
 * the server writes one when it records the issues — and «hace un momento» is
 * the honest answer rather than a clock this page would have to invent.
 */
function whenLabel(pushedAt: string | null): string {
  if (!pushedAt) return 'hace un momento'
  const date = new Date(pushedAt)
  // `pushedAt` is a full timestamp, so — unlike a date-only string — it is safe
  // to let `Date` parse it and render it in the user's own timezone.
  if (Number.isNaN(date.getTime())) return pushedAt
  return `${DAY.format(date)} a las ${TIME.format(date)}`
}

/** The date opening a group is a line of its own, so it starts as one. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
