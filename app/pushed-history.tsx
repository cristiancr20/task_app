'use client'

import type { HistoryEntry } from '@/lib/store'

type Props = {
  /** Every push of this note, oldest first. Never rendered when empty. */
  history: HistoryEntry[]
}

const NUMBER = new Intl.NumberFormat('es-ES')
const DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' })

/**
 * «Ya creaste tareas desde este archivo»: how many, when, and a link to each
 * issue.
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
 */
export function PushedHistory({ history }: Props) {
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

      <div className="mt-1.5 max-h-28 overflow-y-auto">
        {entries.map((entry, key) => (
          <div key={key} className={key > 0 ? 'mt-2' : ''}>
            {/* With a single push the date is already in the line above. */}
            {history.length > 1 ? (
              <p className="text-[0.6875rem] text-muted">{formatPushedAt(entry.pushedAt)}</p>
            ) : null}
            <ul className="flex flex-col gap-1">
              {entry.issues.map((issue) => (
                <li key={issue.id}>
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={`${issue.identifier} · ${issue.title}`}
                    className="group flex items-baseline gap-1.5 text-xs text-content transition-colors hover:text-warn"
                  >
                    <span className="shrink-0 rounded border border-warn/30 px-1 font-mono text-[0.6875rem] text-warn">
                      {issue.identifier}
                    </span>
                    <span className="truncate underline decoration-transparent underline-offset-2 transition-colors group-hover:decoration-current">
                      {issue.title}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
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
 * `pushedAt` is a full timestamp, so — unlike a date-only string — it is safe
 * to let `Date` parse it and render it in the user's own timezone.
 */
function formatPushedAt(pushedAt: string): string {
  const date = new Date(pushedAt)
  if (Number.isNaN(date.getTime())) return pushedAt
  return `${DAY.format(date)} a las ${TIME.format(date)}`
}
