'use client'

import Link from 'next/link'
import { useState } from 'react'

import {
  type Destination,
  destinationSettled,
  destinationSummary,
  excludedSummary,
  pendingSummary,
  pushBlockedBy,
  pushButtonLabel,
  pushOutcome,
} from '@/lib/push-destination'
import type { PushedIssue } from '@/lib/push-events'

import { PushProgress } from './progress'
import type { DuplicateCheckStatus } from './use-duplicate-check'
import type { PushTargetApi } from './use-push-target'

export type ParentApi = {
  /** «Crear tarea padre» is checked. */
  create: boolean
  /** What the input shows: the user's text, or the transcript's title. */
  title: string
  onToggle: (value: boolean) => void
  onTitleChange: (value: string) => void
}

/** The run, as the panel needs to see it: what is left to do and how it is going. */
export type PushApi = {
  status: 'idle' | 'running' | 'finished'
  /** Rows the button would send now: checked and not created yet. */
  pending: number
  /** Rows that failed in the last run — what «Reintentar» would send again. */
  failed: number
  /** Tasks already created for this note, parent aside. */
  created: number
  /** The issues created for this note, in the order they were created. Parent aside. */
  issues: PushedIssue[]
  /**
   * The parent issue, once it exists: this run hangs its tasks from it instead
   * of creating another, and the summary links to it like any other issue.
   */
  parentIssue: PushedIssue | null
  /** Which issue of how many is being created, 1-based. Null when not running. */
  progress: { index: number; total: number } | null
  /** Why the run stopped early, or why it never started. */
  error: string | null
  onPush: () => void
}

/**
 * The duplicate check, as the panel needs to see it: whether it can run at
 * all, whether it is running, and why it could not — never enough to stop a
 * push, only enough to read before starting one.
 */
export type DuplicateApi = {
  status: DuplicateCheckStatus
  /** The destination's issues are loading, or a re-check is about to run. */
  checking: boolean
  /** Why the destination could not be read, or null. */
  error: string | null
  /**
   * Rows left out of this push because the destination already holds them.
   * They are already out of `push.pending`, so this only explains the gap
   * between «10 tareas en la tabla» and the number on the button.
   */
  excluded: number
  /** «Buscar duplicados». */
  onCheck: () => void
}

const FIELD =
  'rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-content shadow-panel outline-none transition-colors placeholder:text-muted focus:border-accent disabled:opacity-50'
const LABEL = 'text-xs font-medium text-muted'

/**
 * The head and the foot of the Linear column are two halves of one control, and
 * both are computed from this: the form's answer, rather than the form.
 *
 * The parent is created once per note, so a run that already made one turns the
 * checkbox into a fact — `existing` — and the title stops being something the
 * user can still get wrong.
 */
export function destinationOf(
  target: PushTargetApi,
  parent: ParentApi,
  push: PushApi,
): Destination {
  const project = target.projects.find((candidate) => candidate.id === target.projectId)
  return {
    status: target.status,
    project: project ? { id: project.id, name: project.name } : null,
    parent: !parent.create ? 'none' : push.parentIssue ? 'existing' : 'new',
    parentTitle: parent.title,
  }
}

type Props = {
  target: PushTargetApi
  parent: ParentApi
  duplicates: DuplicateApi
  push: PushApi
}

/**
 * Where the tasks are going: the Linear team and project, whether they hang
 * from one parent issue — folded, most of the time, into the single line that
 * says both.
 *
 * The destination is chosen here rather than in the settings because it is a
 * per-push decision, and it is remembered in the config because it rarely
 * changes — the dropdown starts on the project used last. That is precisely why
 * the form is folded: a set of fields the user touches once a week was costing
 * a third of the column's height on every note, above a table that is the thing
 * being read. The line it folds into is not a heading, it is the answer — «A
 * Plataforma · bajo «Comité semanal»» — so folding hides the controls, never
 * the decision.
 *
 * It unfolds itself while anything is still missing and folds once the
 * destination is complete, so the form appears exactly when it has to be used;
 * after that the user's own click wins, until something goes missing again.
 *
 * The two chips ride in the panel head, outside the fold: how many tasks are
 * about to be created, and how many the duplicate check took out. Those are
 * about the table, they change on every keystroke in it, and they must not
 * depend on a fold being open.
 */
export function PushPanel({ target, parent, duplicates, push }: Props) {
  const destination = destinationOf(target, parent, push)
  const settled = destinationSettled(destination)
  const running = push.status === 'running'
  const severalTeams = target.teams.length > 1

  // «Reset this state when that changed» in the render body, as in `FileList`:
  // the fold follows completeness until the user disagrees, and their click is
  // forgotten the moment completeness flips — a destination that has just lost
  // its project has to show the field that lost it, whatever was clicked before.
  const [choice, setChoice] = useState<boolean | null>(null)
  const [decidedFor, setDecidedFor] = useState(settled)
  if (decidedFor !== settled) {
    setDecidedFor(settled)
    setChoice(null)
  }
  const open = choice ?? !settled

  return (
    // The top half of the column's action bar, above the button and below
    // whichever pestaña is open. It stacks instead of spreading: at this width
    // a row of side-by-side fields wraps into an unreadable staircase. The
    // whole block is recessed: it is the column's controls, and the rows it
    // acts on are what stays on the light surface above.
    <div className="flex shrink-0 flex-col border-t border-line bg-surface-2">
      <div className="panel-head justify-between">
        <h2 className="panel-title">Enviar a Linear</h2>
        {target.status === 'ready' ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="chip tabular-nums">
              {pendingSummary(push.pending, destination.parent)}
            </span>
            {/* Why the count is lower than the table's: without this the button
                and the list of rows disagree by however many the check took
                out, and nothing on screen would account for the difference. */}
            {duplicates.excluded > 0 ? (
              <span className="chip border-warn/30 text-warn tabular-nums">
                {excludedSummary(duplicates.excluded)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* The fold. It is a button over the whole line rather than a chevron in
          the corner: the line *is* the control, and a 12-pixel target for the
          thing the user opens once per meeting is a worse trade than the row. */}
      <button
        type="button"
        onClick={() => setChoice(!open)}
        aria-expanded={open}
        aria-controls="push-destination"
        className="flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-line/40"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1 truncate text-xs text-content">
          {destinationSummary(destination)}
        </span>
        <span className="shrink-0 text-xs font-medium text-muted">
          {open ? 'Ocultar' : 'Cambiar'}
        </span>
      </button>

      {open ? (
        <div id="push-destination" className="flex flex-col gap-2.5 border-t border-line px-3 py-3">
          {/* One team is not a choice: it is used silently, and only a workspace
              with several ever shows this. */}
          {severalTeams ? (
            <div className="flex items-center gap-3">
              <label htmlFor="push-team" className={`${LABEL} w-20 shrink-0`}>
                Equipo
              </label>
              <select
                id="push-team"
                value={target.teamId}
                onChange={(event) => target.selectTeam(event.target.value)}
                disabled={running}
                className={`${FIELD} min-w-0 flex-1`}
              >
                <option value="">Selecciona un equipo</option>
                {target.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <label htmlFor="push-project" className={`${LABEL} w-20 shrink-0`}>
              Proyecto
            </label>
            <select
              id="push-project"
              value={target.projectId}
              onChange={(event) => target.selectProject(event.target.value)}
              disabled={running || target.status !== 'ready' || target.projects.length === 0}
              className={`${FIELD} min-w-0 flex-1`}
            >
              <option value="">{projectPlaceholder(target, severalTeams)}</option>
              {target.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <input
              id="push-parent"
              type="checkbox"
              checked={parent.create}
              onChange={(event) => parent.onToggle(event.target.checked)}
              disabled={running}
              className="size-4 accent-accent"
            />
            <label htmlFor="push-parent" className="text-sm text-content">
              Agrupar bajo una tarea padre
            </label>
          </div>

          {/* Only worth showing once there is going to be a parent to name — and
              not once it exists, when the title can no longer change anything. */}
          {destination.parent === 'new' ? (
            <input
              id="push-parent-title"
              type="text"
              value={parent.title}
              onChange={(event) => parent.onTitleChange(event.target.value)}
              disabled={running}
              placeholder="Título de la tarea padre"
              aria-label="Título de la tarea padre"
              className={`${FIELD} w-full`}
            />
          ) : null}

          {/* The check runs on its own — after an extraction, and whenever the
              destination changes — so the button is for asking again once
              somebody else has filed something in Linear. It never gates the
              push: what it knows is shown in the table, and what it does not
              know is shown here. */}
          <div className="flex items-start justify-between gap-2 pt-0.5">
            <button
              type="button"
              onClick={duplicates.onCheck}
              disabled={duplicates.status === 'unavailable' || duplicates.checking || running}
              className="rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium shadow-panel transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {duplicates.checking ? 'Buscando duplicados…' : 'Buscar duplicados'}
            </button>
            {/* A notice, not a dialog: a check that could not run is information
                about the check, and interrupting the curating over it would cost
                more than it is worth. */}
            <p
              aria-live="polite"
              className={`min-w-0 flex-1 pt-1 text-right text-xs ${
                duplicates.status === 'error' ? 'text-warn' : 'text-muted'
              }`}
            >
              {duplicateNote(duplicates)}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

type FooterProps = {
  target: PushTargetApi
  parent: ParentApi
  push: PushApi
}

/**
 * The foot of the Linear column: the button, why it is disabled, and — while
 * the run is on — what it is doing.
 *
 * It is a sibling of the table rather than something drawn above it, and the
 * table is the only part of the column that grows, so this stays on screen
 * whatever the meeting produced. That is the whole point: the button is the
 * last gate before something is created in a real workspace, and a gate you
 * have to scroll to find is one you press without reading the rows.
 *
 * It never sits enabled over an incomplete form: `pushBlockedBy` returns the
 * one reason and that reason is what the user reads next to it — one reason,
 * the first one to fix, rather than a list of everything that is missing. After
 * a run with failures the same button becomes «Reintentar N fallidas», because
 * retrying is not a different action: it is the same push over what is left,
 * and what was created is no longer part of it.
 *
 * While it runs, the progress takes the button's place — same spot, so the eye
 * does not have to move — and the destination above is not editable, which is
 * enforced there rather than here: every field of the form is disabled by the
 * same `running`.
 */
export function PushFooter({ target, parent, push }: FooterProps) {
  const destination = destinationOf(target, parent, push)
  const running = push.status === 'running'
  const finished = push.status === 'finished'
  const reason = pushBlockedBy({
    destination,
    error: target.error,
    running,
    pending: push.pending,
    created: push.created,
  })

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-surface-2 px-3 py-2.5">
      {/* Why the run stopped short: the parent failed, or too many tasks failed
          in a row. The per-row messages are in the table. */}
      {push.error ? (
        <p role="alert" className="rounded-md bg-danger-wash px-3 py-2 text-xs text-danger">
          {push.error}
        </p>
      ) : null}

      {finished ? (
        <p aria-live="polite" className="text-xs text-content">
          {pushOutcome({
            created: push.created,
            failed: push.failed,
            underParent: push.parentIssue !== null,
          })}
        </p>
      ) : null}

      {/* Once it is over the summary lists what was created, linked: the table
          says which row became which issue, but the point of finishing a push
          is to open the issues, and hunting for them column by column is not
          that. It scrolls inside a bounded box — a dozen links must not push
          the button they came from off the bottom of the column.
          The parent goes first and says so: it is the issue the others hang
          from, and the one the user opens to see the meeting as a whole. */}
      {finished && (push.parentIssue || push.issues.length > 0) ? (
        <ul className="flex max-h-24 flex-col gap-1 overflow-y-auto">
          {push.parentIssue ? <IssueLink issue={push.parentIssue} label="tarea padre" /> : null}
          {push.issues.map((issue) => (
            <IssueLink key={issue.id} issue={issue} />
          ))}
        </ul>
      ) : null}

      {running ? (
        push.progress ? (
          <PushProgress index={push.progress.index} total={push.progress.total} />
        ) : (
          <p role="status" aria-live="polite" className="text-sm text-content">
            Creando las tareas en Linear…
          </p>
        )
      ) : (
        <>
          {reason ? (
            <p className="text-xs text-muted">
              {reason}{' '}
              {target.status === 'no-key' ? (
                <Link href="/settings" className="underline hover:text-content">
                  Ir a ajustes
                </Link>
              ) : null}
              {target.status === 'error' ? (
                <button
                  type="button"
                  onClick={target.reload}
                  className="underline hover:text-content"
                >
                  Reintentar
                </button>
              ) : null}
            </p>
          ) : null}

          <button
            type="button"
            onClick={push.onPush}
            disabled={reason !== null}
            title={reason ?? undefined}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-on-accent shadow-panel transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {pushButtonLabel({ running, pending: push.pending, failed: push.failed })}
          </button>
        </>
      )}
    </div>
  )
}

/** The fold's only ornament: pointing down when the form is open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-3 w-3 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6,3.5 10.5,8 6,12.5" />
    </svg>
  )
}

/** One created issue: its identifier, its title, and a link to Linear. */
function IssueLink({ issue, label }: { issue: PushedIssue; label?: string }) {
  return (
    <li className="text-xs">
      <a
        href={issue.url}
        target="_blank"
        rel="noreferrer noopener"
        className="group flex items-baseline gap-1.5 text-content transition-colors hover:text-accent"
      >
        <span className="shrink-0 rounded border border-line px-1 font-mono text-[0.6875rem] text-muted group-hover:border-accent/40 group-hover:text-accent">
          {issue.identifier}
        </span>
        <span className="truncate underline decoration-transparent underline-offset-2 transition-colors group-hover:decoration-current">
          {issue.title}
        </span>
        {label ? <span className="shrink-0 text-muted">({label})</span> : null}
      </a>
    </li>
  )
}

/**
 * What the check has to say next to its button. Every one of these is a state
 * the push runs in regardless — the check informs the decision, it does not
 * make it — so none of them is phrased as something to fix first.
 */
function duplicateNote(duplicates: DuplicateApi): string {
  if (duplicates.status === 'unavailable') return 'Elige el destino para comprobar duplicados.'
  if (duplicates.status === 'error')
    return duplicates.error ?? 'No se pudieron comprobar los duplicados.'
  if (duplicates.checking) return 'Comparando con lo que ya hay en el proyecto…'
  return 'Comparado con los issues del proyecto.'
}

/** What the dropdown says when it has nothing to offer, and why. */
function projectPlaceholder(target: PushTargetApi, severalTeams: boolean): string {
  if (target.status === 'loading') return 'Cargando…'
  if (target.status === 'no-key') return 'Sin API key'
  if (target.status === 'error') return 'No disponible'
  if (severalTeams && !target.teamId) return 'Elige un equipo primero'
  if (target.projects.length === 0) return 'El equipo no tiene proyectos'
  return 'Selecciona un proyecto'
}
