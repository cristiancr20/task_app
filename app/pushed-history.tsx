'use client'

import {
  groupOfStateType,
  ISSUE_STATE_GROUPS,
  type IssueStateGroup,
} from '@/lib/issue-state-summary'
import type { HistoryEntry } from '@/lib/store'

import type { IssueStatesApi } from './use-issue-states'

type Props = {
  /** Every push of this note, oldest first. Never rendered when empty. */
  history: HistoryEntry[]
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
 * The colour of each group, on the dot next to a count and next to an issue.
 * Cancelled is muted rather than red: the work was dropped on purpose, which
 * is news but not a problem to fix.
 */
const GROUP_DOT: Record<IssueStateGroup, string> = {
  completed: 'bg-ok',
  started: 'bg-info',
  unstarted: 'bg-muted',
  canceled: 'bg-muted',
}

/**
 * «Ya creaste tareas desde este archivo»: how many, when, what became of them,
 * and a link to each issue.
 *
 * It lives in the Linear column rather than over the transcript, because it is
 * about what this note produced in Linear — the same subject as the panel it
 * now sits in — and above the text it cost the reader the top of every note
 * that had ever been pushed.
 *
 * Entries are stored oldest first and shown newest first, since the last push
 * is the one that explains the current state of the file. The list scrolls
 * inside a fixed height: a note pushed five times must not take the column
 * away from the tasks being prepared in it.
 *
 * The states are an addition to that history and never a replacement for it:
 * while they load, when there is no key to load them with, and when the query
 * fails, every line below is exactly what it was before — the report is what
 * is missing, not the record of the push.
 */
export function PushedHistory({ history, states }: Props) {
  const entries = [...history].reverse()
  const total = history.reduce((count, entry) => count + entry.issues.length, 0)
  const latest = entries[0]

  return (
    <div role="note" className="border-b border-line bg-warn-wash px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-warn">
        <Tick />
        {total === 1 ? '1 tarea ya creada' : `${NUMBER.format(total)} tareas ya creadas`}
        <span className="font-normal text-muted">
          {history.length > 1
            ? `· ${history.length} envíos, el último el ${formatPushedAt(latest.pushedAt)}`
            : `· ${formatPushedAt(latest.pushedAt)}`}
        </span>
      </p>

      <StateReport states={states} />

      <div className="mt-1.5 max-h-28 overflow-y-auto">
        {entries.map((entry, key) => (
          <div key={key} className={key > 0 ? 'mt-2' : ''}>
            {/* With a single push the date is already in the line above. */}
            {history.length > 1 ? (
              <p className="text-[0.6875rem] text-muted">{formatPushedAt(entry.pushedAt)}</p>
            ) : null}
            <ul className="flex flex-col gap-1">
              {entry.issues.map((issue) => {
                const state = states.byId[issue.id]
                return (
                  <li key={issue.id}>
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`${issue.identifier} · ${issue.title}${
                        state ? ` · ${state.stateName}` : ''
                      }`}
                      className="group flex items-baseline gap-1.5 text-xs text-content transition-colors hover:text-warn"
                    >
                      <span className="shrink-0 rounded border border-warn/30 px-1 font-mono text-[0.6875rem] text-warn">
                        {issue.identifier}
                      </span>
                      <span className="truncate underline decoration-transparent underline-offset-2 transition-colors group-hover:decoration-current">
                        {issue.title}
                      </span>
                      {/* Linear's own wording for the state, not ours: the
                          workspace named its columns, and «Listo para QA» says
                          more to whoever runs the meeting than «en curso». */}
                      {state ? (
                        <span className="ml-auto flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted">
                          <Dot group={groupOfStateType(state.stateType)} />
                          {state.stateName}
                        </span>
                      ) : null}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
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
          onClick={states.retry}
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
    <p aria-live="polite" className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {ISSUE_STATE_GROUPS.filter((group) => summary[group] > 0).map((group) => (
        <span key={group} className="flex items-center gap-1 text-[0.6875rem] text-muted">
          <Dot group={group} />
          <span className="font-medium text-content tabular-nums">{summary[group]}</span>
          {GROUP_LABELS[group]}
        </span>
      ))}
    </p>
  )
}

function Dot({ group }: { group: IssueStateGroup }) {
  return <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${GROUP_DOT[group]}`} />
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
 * `pushedAt` is a full timestamp, so — unlike a date-only string — it is safe
 * to let `Date` parse it and render it in the user's own timezone.
 */
function formatPushedAt(pushedAt: string): string {
  const date = new Date(pushedAt)
  if (Number.isNaN(date.getTime())) return pushedAt
  return `${DAY.format(date)} a las ${TIME.format(date)}`
}
