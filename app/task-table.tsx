'use client'

import { PRIORITIES, type Priority } from '@/lib/extractors/task'

import type { TaskDraft, TaskDraftState } from './use-task-drafts'

type Props = {
  /** The selected file's drafts, or undefined when no file is selected. */
  state: TaskDraftState | undefined
  onGenerate: () => void
  onUpdateRow: (id: string, changes: Partial<TaskDraft>) => void
  onRemoveRow: (id: string) => void
  onAddRow: () => void
}

/** Linear's scale, in the words the user reads. */
const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
  none: 'Sin prioridad',
}

const CELL = 'align-top px-3 py-2'
const FIELD =
  'w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300'

/**
 * The bottom panel: what will be created in Linear, before it is created.
 *
 * Everything the model decided is editable except the two columns that exist to
 * be checked — the evidence line and the person the transcript named. Editing
 * those would defeat the point: they are the proof the task is real, and they
 * travel to Linear as the traceability block.
 */
export function TaskTable({ state, onGenerate, onUpdateRow, onRemoveRow, onAddRow }: Props) {
  const rows = state?.rows ?? []
  const selected = rows.filter((row) => row.include).length
  const generating = state?.generating ?? false

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Tareas</h2>
          {rows.length > 0 ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {selected} de {rows.length} seleccionada{rows.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAddRow}
            disabled={!state}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Añadir tarea
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!state || generating}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {generating ? 'Generando…' : 'Generar tareas'}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The error sits above the table and never replaces it: a failed
            regeneration must not throw away rows the user already curated. */}
        {state?.error ? (
          <p
            role="alert"
            className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            {state.error}
          </p>
        ) : null}

        {generating && rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            Extrayendo tareas de la transcripción…
          </p>
        ) : rows.length === 0 ? (
          <Empty extracted={state?.extracted ?? false} />
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th scope="col" className="w-10 px-3 py-2 font-medium">
                  <span className="sr-only">Incluir</span>
                </th>
                <th scope="col" className="w-1/4 px-3 py-2 font-medium">
                  Título
                </th>
                <th scope="col" className="w-1/3 px-3 py-2 font-medium">
                  Descripción
                </th>
                {/* Wide enough for «Sin prioridad» plus the select's own
                    chevron, which otherwise clips the longest option. */}
                <th scope="col" className="w-40 px-3 py-2 font-medium">
                  Prioridad
                </th>
                <th scope="col" className="w-32 px-3 py-2 font-medium">
                  Mencionado
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Evidencia
                </th>
                <th scope="col" className="w-10 px-3 py-2 font-medium">
                  <span className="sr-only">Eliminar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  onUpdate={(changes) => onUpdateRow(row.id, changes)}
                  onRemove={() => onRemoveRow(row.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Row({
  row,
  onUpdate,
  onRemove,
}: {
  row: TaskDraft
  onUpdate: (changes: Partial<TaskDraft>) => void
  onRemove: () => void
}) {
  // An excluded row stays legible but visibly out of the push.
  const dimmed = row.include ? '' : 'opacity-50'
  const label = row.title.trim() || 'tarea sin título'

  return (
    <tr className={`border-b border-zinc-100 dark:border-zinc-900 ${dimmed}`}>
      <td className={CELL}>
        <input
          type="checkbox"
          checked={row.include}
          onChange={(event) => onUpdate({ include: event.target.checked })}
          aria-label={`Incluir ${label}`}
          className="mt-2 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
        />
      </td>

      <td className={CELL}>
        <input
          type="text"
          value={row.title}
          onChange={(event) => onUpdate({ title: event.target.value })}
          aria-label="Título"
          placeholder="Título de la tarea"
          className={FIELD}
        />
      </td>

      <td className={CELL}>
        <textarea
          value={row.description}
          onChange={(event) => onUpdate({ description: event.target.value })}
          aria-label="Descripción"
          rows={2}
          placeholder="Contexto de la tarea"
          className={`${FIELD} resize-y`}
        />
      </td>

      <td className={CELL}>
        <select
          value={row.priority}
          onChange={(event) => onUpdate({ priority: event.target.value as Priority })}
          aria-label="Prioridad"
          className={FIELD}
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </td>

      <td className={`${CELL} text-sm text-zinc-600 dark:text-zinc-400`}>
        {row.mentioned ?? <span className="text-zinc-400 dark:text-zinc-600">—</span>}
      </td>

      <td className={`${CELL} text-sm text-zinc-500 dark:text-zinc-400`}>
        {row.evidence ? (
          <q
            title={row.evidence}
            className="block max-h-20 overflow-y-auto italic leading-snug"
          >
            {row.evidence}
          </q>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">Añadida manualmente</span>
        )}
      </td>

      <td className={CELL}>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Eliminar ${label}`}
          title="Eliminar"
          className="mt-1 rounded-md border border-transparent px-2 py-1 text-sm text-zinc-500 transition-colors hover:border-red-300 hover:text-red-600 dark:text-zinc-400 dark:hover:border-red-900 dark:hover:text-red-400"
        >
          ✕
        </button>
      </td>
    </tr>
  )
}

/**
 * Nothing to show yet. Whether an extraction has run is the difference between
 * «press the button» and «the model found no commitments here».
 */
function Empty({ extracted }: { extracted: boolean }) {
  return (
    <div className="px-5 py-6">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {extracted ? 'No se encontraron tareas en esta transcripción' : 'Aún no hay tareas'}
      </p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {extracted
          ? 'La transcripción no contiene compromisos claros. Puedes añadir una tarea manualmente.'
          : 'Pulsa «Generar tareas» para extraerlas de la transcripción, o añade una manualmente.'}
      </p>
    </div>
  )
}
