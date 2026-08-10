'use client'

import Link from 'next/link'

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
  /** The parent already exists, so this run hangs the tasks from it instead of creating another. */
  parentCreated: boolean
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
  'rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300'
const LABEL = 'text-xs font-medium text-zinc-500 dark:text-zinc-400'

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
  const willCreateParent = parent.create && !push.parentCreated

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-5 py-3">
        {/* One team is not a choice: it is used silently, and only a workspace
            with several ever shows this. */}
        {severalTeams ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="push-team" className={LABEL}>
              Equipo
            </label>
            <select
              id="push-team"
              value={target.teamId}
              onChange={(event) => target.selectTeam(event.target.value)}
              disabled={running}
              className={`${FIELD} w-44`}
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

        <div className="flex flex-col gap-1">
          <label htmlFor="push-project" className={LABEL}>
            Proyecto
          </label>
          <select
            id="push-project"
            value={target.projectId}
            onChange={(event) => target.selectProject(event.target.value)}
            disabled={running || target.status !== 'ready' || target.projects.length === 0}
            className={`${FIELD} w-56`}
          >
            <option value="">{projectPlaceholder(target, severalTeams)}</option>
            {target.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Tarea padre</span>
          <div className="flex items-center gap-2">
            <input
              id="push-parent"
              type="checkbox"
              checked={parent.create}
              onChange={(event) => parent.onToggle(event.target.checked)}
              disabled={running}
              className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
            />
            <label htmlFor="push-parent" className="text-sm text-zinc-700 dark:text-zinc-300">
              Crear tarea padre
            </label>
          </div>
        </div>

        {/* Only worth showing once there is going to be a parent to name — and
            not once it exists, when the title can no longer change anything. */}
        {willCreateParent ? (
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <label htmlFor="push-parent-title" className={LABEL}>
              Título de la tarea padre
            </label>
            <input
              id="push-parent-title"
              type="text"
              value={parent.title}
              onChange={(event) => parent.onTitleChange(event.target.value)}
              disabled={running}
              placeholder="Título de la reunión"
              className={`${FIELD} w-full`}
            />
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          {reason ? (
            <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
              {reason}{' '}
              {target.status === 'no-key' ? (
                <Link
                  href="/settings"
                  className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  Ir a ajustes
                </Link>
              ) : null}
              {target.status === 'error' ? (
                <button
                  type="button"
                  onClick={target.reload}
                  className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  Reintentar
                </button>
              ) : null}
            </p>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {summary(willCreateParent, push.pending)}
            </p>
          )}

          <button
            type="button"
            onClick={push.onPush}
            disabled={reason !== null}
            title={reason ?? undefined}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {buttonLabel(push)}
          </button>
        </div>
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
 */
function RunStatus({ push }: { push: PushApi }) {
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 px-5 py-2 dark:border-zinc-800">
      {push.progress && push.status === 'running' ? (
        <p aria-live="polite" className="text-xs text-zinc-600 dark:text-zinc-300">
          {`Creando ${Math.max(push.progress.index, 1)} de ${push.progress.total}…`}
        </p>
      ) : null}

      {push.status === 'finished' ? (
        <p aria-live="polite" className="text-xs text-zinc-600 dark:text-zinc-300">
          {outcome(push)}
        </p>
      ) : null}

      {/* Why the run stopped short: the parent failed, or too many tasks failed
          in a row. The per-row messages are in the table. */}
      {push.error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {push.error}
        </p>
      ) : null}
    </div>
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
  if (parent.create && !push.parentCreated && !parent.title.trim())
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
    push.parentCreated && push.created > 0 ? ' bajo la tarea padre' : ''
  }`
  return push.failed > 0
    ? `${created} · ${push.failed} fallida${push.failed === 1 ? '' : 's'}`
    : created
}
