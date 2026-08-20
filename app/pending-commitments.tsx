'use client'

import { useState } from 'react'

import { formatElapsed } from '@/lib/elapsed'
import { groupOfStateType } from '@/lib/issue-state-summary'
import type { PendingCommitment } from '@/lib/pending-commitments'

import { StateDot } from './issue-state-dot'

type Props = {
  /** What previous meetings of this project left open, oldest first. */
  commitments: readonly PendingCommitment[]
  /** Open the note a commitment came from — the explorer's own selection. */
  onOpenNote: (relPath: string) => void
}

/**
 * How many rows are shown before «Ver todas».
 *
 * Five is about as much as can be read without deciding to read it: the panel
 * sits above the tasks of the meeting being prepared, and a client with thirty
 * open commitments would otherwise push the actual work off the screen. The
 * list is sorted oldest first, so the five that are shown are the five worth
 * asking about.
 */
const PREVIEW = 5

const DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * «Pendiente de reuniones anteriores»: what previous meetings of this same
 * project promised and nobody has closed yet.
 *
 * It is the one block on the page that is not about the note being read. Its
 * whole purpose is to be seen *before* the meeting starts — the things somebody
 * should be asked about today — so it sits with the note's own history rather
 * than in a screen of its own, and every row says who it belongs to and how
 * long it has been waiting.
 *
 * Everything that could make it noise is designed out:
 *
 * - It disappears when there is nothing pending. An empty «no hay pendientes»
 *   block would be a permanent fixture that says nothing, on a page where the
 *   room belongs to the transcript and the tasks.
 * - It folds. Somebody who has already read it, or who is not running this
 *   meeting, gets one line back.
 * - It shows the five oldest and offers the rest behind «Ver todas», so a
 *   long-running project cannot bury the tasks below it.
 *
 * The selection itself — which commitments, in what order, and why an old entry
 * or an unknown state is left out — is `lib/pendingCommitments`, where it is
 * tested. This file only draws it.
 */
export function PendingCommitments({ commitments, onOpenNote }: Props) {
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
  // One instant for the whole list: two rows pushed together must not read as
  // «hace 1 semana» and «hace 2 semanas» because of when they were rendered.
  const now = Date.now()

  // Nothing pending is nothing to say. This is after the hooks on purpose —
  // the panel appears and disappears as the project changes, and a hook that
  // ran conditionally would take the fold state with it.
  if (commitments.length === 0) return null

  const shown = showAll ? commitments : commitments.slice(0, PREVIEW)
  const hidden = commitments.length - shown.length

  return (
    <section
      aria-label="Pendiente de reuniones anteriores"
      className="border-b border-line bg-info-wash px-3 py-2.5"
    >
      <button
        type="button"
        onClick={() => setOpen((it) => !it)}
        aria-expanded={open}
        aria-controls="pending-commitments-list"
        className="flex w-full items-center gap-1.5 text-xs font-semibold text-info"
      >
        <Chevron open={open} />
        Pendiente de reuniones anteriores
        <span className="font-normal text-muted tabular-nums">· {commitments.length}</span>
      </button>

      {open ? (
        <div id="pending-commitments-list" className="mt-1.5">
          {/* «Ver todas» can turn five rows into thirty, and the tasks being
              prepared below must not be pushed off the column for it — the same
              bargain the note's own history makes. The control stays outside
              the scroll area, so it is still there to fold the list back. */}
          <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
            {shown.map((commitment) => (
              <Row key={commitment.issue.id} commitment={commitment} now={now} onOpenNote={onOpenNote} />
            ))}
          </ul>

          {hidden > 0 || showAll ? (
            <button
              type="button"
              onClick={() => setShowAll((it) => !it)}
              className="mt-1.5 text-[0.6875rem] text-muted underline underline-offset-2 transition-colors hover:text-content"
            >
              {showAll ? 'Ver solo las más antiguas' : `Ver todas (${commitments.length})`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/**
 * One commitment: what it is, who was named for it, how long it has been open
 * and where it came from.
 *
 * The issue itself is a link to Linear — the place where it can actually be
 * moved — and the meeting it came from is a *button*, because opening a note is
 * a change of what this page is showing and not a navigation away from it. They
 * are deliberately not the same control: the row answers two different
 * questions and each of them has its own destination.
 *
 * The state's name is Linear's own wording, as everywhere else: the workspace
 * named its columns, and «Listo para QA» says more than «en curso» to whoever
 * is running the meeting.
 */
function Row({
  commitment,
  now,
  onOpenNote,
}: {
  commitment: PendingCommitment
  now: number
  onOpenNote: (relPath: string) => void
}) {
  const { issue, mentioned, notePath, noteTitle, pushedAt } = commitment
  const elapsed = formatElapsed(pushedAt, now)

  return (
    <li>
      <a
        href={issue.url}
        target="_blank"
        rel="noreferrer noopener"
        title={`${issue.identifier} · ${issue.title} · ${issue.stateName}`}
        className="group flex items-baseline gap-1.5 text-xs text-content transition-colors hover:text-info"
      >
        <span className="shrink-0 rounded border border-info/30 px-1 font-mono text-[0.6875rem] text-info">
          {issue.identifier}
        </span>
        <span className="truncate underline decoration-transparent underline-offset-2 transition-colors group-hover:decoration-current">
          {issue.title}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted">
          <StateDot group={groupOfStateType(issue.stateType)} />
          {issue.stateName}
        </span>
      </a>

      {/* Where it came from, who was named and how long it has been waiting —
          the three things that turn an open issue into something to bring up
          today. Each is dropped rather than faked when it is not known. */}
      <p className="mt-0.5 flex items-baseline gap-1.5 text-[0.6875rem] text-muted">
        <button
          type="button"
          onClick={() => onOpenNote(notePath)}
          title={`Abrir «${noteTitle}»`}
          className="min-w-0 shrink truncate underline underline-offset-2 transition-colors hover:text-content"
        >
          {noteTitle}
        </button>
        {mentioned ? <span className="shrink-0">· {mentioned}</span> : null}
        {elapsed ? (
          <span className="shrink-0" title={`Creada el ${formatDay(pushedAt)}`}>
            · abierta {elapsed}
          </span>
        ) : null}
      </p>
    </li>
  )
}

/** The fold indicator, pointing down when the list is open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`size-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6,3.5 10.5,8 6,12.5" />
    </svg>
  )
}

/** The exact date behind «hace 3 semanas», for the hover that wants it. */
function formatDay(pushedAt: string): string {
  const date = new Date(pushedAt)
  return Number.isNaN(date.getTime()) ? pushedAt : DAY.format(date)
}
