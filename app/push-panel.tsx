'use client'

import Link from 'next/link'

import type { PushedIssue } from '@/lib/push-events'

import { PushProgress } from './progress'
import type { PushTargetApi } from './use-push-target'

type ParentApi = {
  /** «Crear tarea padre» is checked. */
  create: boolean
  /** What the input shows: the user's text, or the transcript's title. */
  title: string
  onToggle: (value: boolean) => void
  onTitleChange: (value: string) => void
}

/** The run, as the panel needs to see it: what is left to do and how it is going. */
type PushApi = {
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

type Props = {
  target: PushTargetApi
  parent: ParentApi
  push: PushApi
}

const FIELD =
  'rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-content shadow-panel outline-none transition-colors placeholder:text-muted focus:border-accent disabled:opacity-50'
const LABEL = 'text-xs font-medium text-muted'

/**
 * Where the tasks are going: the Linear team and project, whether they hang
 * from one parent issue — and, once the button is pressed, how the run is going.
 *
 * The destination is chosen here rather than in the settings because it is a
 * per-push decision, and it is remembered in the config because it rarely
 * changes — the dropdown starts on the project used last.
 *
 * The button is the last gate before something is created in a real workspace,
 * so it never sits enabled over an incomplete form: `pushBlockedBy` returns the
 * one reason it is disabled and that reason is what the user reads next to it.
 * After a run with failures the same button becomes «Reintentar N fallidas»,
 * because retrying is not a different action — it is the same push over what is
 * left, and what was created is no longer part of it.
 */
export function PushPanel({ target, parent, push }: Props) {
  const reason = pushBlockedBy(target, parent, push)
  const severalTeams = target.teams.length > 1
  const running = push.status === 'running'
  // The parent is created once per note; a retry hangs its tasks from the one
  // that already exists, so the checkbox stops describing this run.
  const willCreateParent = parent.create && !push.parentIssue

  return (
    // Header of the tasks column, so it stacks instead of spreading: at this
    // width a row of side-by-side fields wraps into an unreadable staircase.
    // The whole block is recessed: it is the panel's controls, and the rows it
    // acts on are what should stay on the light surface below.
    <div className="flex flex-col border-b border-line bg-surface-2">
      <div className="panel-head justify-between">
        <h2 className="panel-title">Enviar a Linear</h2>
        {target.status === 'ready' ? (
          <span className="chip tabular-nums">{summary(willCreateParent, push.pending)}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5 px-3 py-3">
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
        {willCreateParent ? (
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
          {buttonLabel(push)}
        </button>
      </div>

      {push.status !== 'idle' ? <RunStatus push={push} /> : null}
    </div>
  )
}

/**
 * What the run is doing, under the controls that started it.
 *
 * The progress line is the whole reason the route streams: a push is a dozen
 * round trips to a remote API, and «Creando 4 de 12» is the difference between
 * a slow run and a hung one. The row-by-row outcome is in the table above —
 * this says what happened overall, and why it stopped when it stopped.
 *
 * Once it is over the summary lists what was created, linked: the table says
 * which row became which issue, but the point of finishing a push is to open
 * the issues, and hunting for them column by column is not that.
 */
function RunStatus({ push }: { push: PushApi }) {
  const finished = push.status === 'finished'

  return (
    <div className="flex flex-col gap-2 border-t border-line bg-surface px-3 py-2.5">
      {push.progress && push.status === 'running' ? (
        <PushProgress index={push.progress.index} total={push.progress.total} />
      ) : null}

      {finished ? (
        <p aria-live="polite" className="text-xs text-content">
          {outcome(push)}
        </p>
      ) : null}

      {/* The parent goes first and says so: it is the issue the others hang
          from, and the one the user opens to see the meeting as a whole. */}
      {finished && (push.parentIssue || push.issues.length > 0) ? (
        <ul className="flex flex-col gap-1 pb-1">
          {push.parentIssue ? <IssueLink issue={push.parentIssue} label="tarea padre" /> : null}
          {push.issues.map((issue) => (
            <IssueLink key={issue.id} issue={issue} />
          ))}
        </ul>
      ) : null}

      {/* Why the run stopped short: the parent failed, or too many tasks failed
          in a row. The per-row messages are in the table. */}
      {push.error ? (
        <p
          role="alert"
          className="rounded-md bg-danger-wash px-3 py-2 text-xs text-danger"
        >
          {push.error}
        </p>
      ) : null}
    </div>
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
 * Why the push cannot run, or null when it can. Ordered by what the user has to
 * fix first: there is no point asking for a project while the key is missing,
 * and the project dropdown is empty until the listing lands.
 */
function pushBlockedBy(target: PushTargetApi, parent: ParentApi, push: PushApi): string | null {
  if (target.status === 'no-key') return 'No hay ninguna API key de Linear guardada.'
  if (target.status === 'loading') return 'Cargando los proyectos de Linear…'
  if (target.status === 'error')
    return target.error ?? 'No se pudieron cargar los proyectos de Linear.'
  if (!target.projectId) return 'Selecciona el proyecto de destino.'
  if (push.status === 'running') return 'Creando las tareas en Linear…'
  if (push.pending === 0) {
    // Nothing left is not the same as nothing chosen: after a clean run every
    // checked row exists in Linear, and offering to create them again is how
    // duplicates happen.
    return push.created > 0
      ? 'Todas las tareas seleccionadas ya se han creado en Linear.'
      : 'Marca al menos una tarea para crearla.'
  }
  // Linear rejects an empty title, so the push would fail on the parent and
  // never reach the tasks. Once the parent exists this no longer applies.
  if (parent.create && !push.parentIssue && !parent.title.trim())
    return 'Escribe un título para la tarea padre.'
  return null
}

/**
 * «Reintentar 2 fallidas» once a run left failures behind, «Crear en Linear»
 * otherwise. The number is always what the button is about to send, which is
 * not always the failures: a run that aborted left rows it never attempted, and
 * those go out too — naming only the failures would undercount the run the user
 * is starting.
 */
function buttonLabel(push: PushApi): string {
  if (push.status === 'running') return 'Creando…'
  if (push.failed === 0) return 'Crear en Linear'
  if (push.pending > push.failed) {
    return `Reintentar ${push.pending} pendientes`
  }
  return `Reintentar ${push.failed} fallida${push.failed === 1 ? '' : 's'}`
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

/** «3 tareas bajo una tarea padre», so the button says what it is about to do. */
function summary(willCreateParent: boolean, pending: number): string {
  const tasks = `${pending} tarea${pending === 1 ? '' : 's'}`
  return willCreateParent ? `${tasks} bajo una tarea padre` : tasks
}

/** «3 tareas creadas bajo la tarea padre · 1 fallida», once the run is over. */
function outcome(push: PushApi): string {
  const one = push.created === 1
  // With nothing created, the parent is not what the sentence is about.
  const created = `${push.created} tarea${one ? '' : 's'} creada${one ? '' : 's'}${
    push.parentIssue && push.created > 0 ? ' bajo la tarea padre' : ''
  }`
  return push.failed > 0
    ? `${created} · ${push.failed} fallida${push.failed === 1 ? '' : 's'}`
    : created
}
