'use client'

import { useInboxApi } from './inbox-provider'
import { useSearchApi } from './search-provider'

const NUMBER = new Intl.NumberFormat('es-ES')

/**
 * The way into the inbox, in the header: a toggle that also carries how many
 * notes are pending.
 *
 * The count is on the button rather than only inside the view because it is
 * the answer to the question the view exists for — «¿me queda algo por
 * procesar?» — and reading it should not cost a click. It appears as soon as
 * the first load answers, and stays put while a reload is in flight so the
 * header does not flicker every time the disk is walked again.
 *
 * Opening the inbox empties the search: they are two ways of replacing the
 * same part of the screen, and a query left behind the inbox would take it
 * over again the moment the inbox was closed.
 */
export function InboxButton() {
  const inbox = useInboxApi()
  const search = useSearchApi()
  const { total } = inbox.counts
  const { loaded } = inbox.state

  return (
    <button
      type="button"
      aria-pressed={inbox.open}
      onClick={() => {
        if (inbox.open) {
          inbox.hide()
          return
        }
        search.clear()
        inbox.show()
      }}
      title={inbox.open ? 'Volver al explorador' : 'Ver las notas sin procesar'}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium shadow-panel transition-colors ${
        inbox.open
          ? 'border-accent bg-accent-wash text-content'
          : 'border-line bg-surface hover:bg-surface-2'
      }`}
    >
      <InboxIcon />
      <span>Bandeja</span>
      {/* Nothing is claimed before the first answer: a `0` on a button that has
          not asked yet would read as «no queda nada», which is exactly the
          thing this button must never say by accident. */}
      {loaded ? (
        <span
          className={`rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
            total > 0 ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted'
          }`}
        >
          {NUMBER.format(total)}
        </span>
      ) : null}
      <span className="sr-only">
        {loaded ? `${NUMBER.format(total)} notas sin procesar` : 'Contando notas sin procesar'}
      </span>
    </button>
  )
}

function InboxIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 9.5 3.75 3.25h8.5L14 9.5v3.25H2z" />
      <path d="M2 9.5h3l1 1.75h4l1-1.75h3" />
    </svg>
  )
}
