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

type Props = {
  target: PushTargetApi
  parent: ParentApi
  /** How many rows of the table are checked — what the push would create. */
  selectedTasks: number
  /** Runs the push. Wired by US-018; the panel only decides when it may run. */
  onPush?: () => void
}

const FIELD =
  'rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300'
const LABEL = 'text-xs font-medium text-zinc-500 dark:text-zinc-400'

/**
 * Where the tasks are going: the Linear team and project, and whether they hang
 * from one parent issue.
 *
 * The destination is chosen here rather than in the settings because it is a
 * per-push decision, and it is remembered in the config because it rarely
 * changes — the dropdown starts on the project used last.
 *
 * The button is the last gate before something is created in a real workspace,
 * so it never sits enabled over an incomplete form: `pushBlockedBy` returns the
 * one reason it is disabled and that reason is what the user reads next to it.
 */
export function PushPanel({ target, parent, selectedTasks, onPush }: Props) {
  const reason = pushBlockedBy(target, parent, selectedTasks)
  const severalTeams = target.teams.length > 1

  return (
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
          disabled={target.status !== 'ready' || target.projects.length === 0}
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
            className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
          />
          <label htmlFor="push-parent" className="text-sm text-zinc-700 dark:text-zinc-300">
            Crear tarea padre
          </label>
        </div>
      </div>

      {/* Only worth showing once there is going to be a parent to name. */}
      {parent.create ? (
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label htmlFor="push-parent-title" className={LABEL}>
            Título de la tarea padre
          </label>
          <input
            id="push-parent-title"
            type="text"
            value={parent.title}
            onChange={(event) => parent.onTitleChange(event.target.value)}
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
              <Link href="/settings" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{summary(parent, selectedTasks)}</p>
        )}

        <button
          type="button"
          onClick={onPush}
          disabled={reason !== null}
          title={reason ?? undefined}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Crear en Linear
        </button>
      </div>
    </div>
  )
}

/**
 * Why the push cannot run, or null when it can. Ordered by what the user has to
 * fix first: there is no point asking for a project while the key is missing,
 * and the project dropdown is empty until the listing lands.
 */
function pushBlockedBy(
  target: PushTargetApi,
  parent: ParentApi,
  selectedTasks: number,
): string | null {
  if (target.status === 'no-key') return 'No hay ninguna API key de Linear guardada.'
  if (target.status === 'loading') return 'Cargando los proyectos de Linear…'
  if (target.status === 'error')
    return target.error ?? 'No se pudieron cargar los proyectos de Linear.'
  if (!target.projectId) return 'Selecciona el proyecto de destino.'
  if (selectedTasks === 0) return 'Marca al menos una tarea para crearla.'
  // Linear rejects an empty title, so the push would fail on the parent and
  // never reach the tasks.
  if (parent.create && !parent.title.trim()) return 'Escribe un título para la tarea padre.'
  return null
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

/** «3 tareas y 1 tarea padre», so the button says what it is about to do. */
function summary(parent: ParentApi, selectedTasks: number): string {
  const tasks = `${selectedTasks} tarea${selectedTasks === 1 ? '' : 's'}`
  return parent.create ? `${tasks} bajo una tarea padre` : tasks
}
