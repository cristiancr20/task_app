'use client'

import { useEffect } from 'react'

import { PRIORITIES, type Priority } from '@/lib/extractors/task'

import { ExtractionProgress } from './progress'

import type { PushRowResult } from './use-push-run'
import {
  countManualChanges,
  type ManualChanges,
  type TaskDraft,
  type TaskDraftState,
} from './use-task-drafts'

type Props = {
  /** The selected file's drafts, or undefined when no file is selected. */
  state: TaskDraftState | undefined
  /**
   * How each row ended in the last push, by row id. Empty until one runs, which
   * is when the «Estado» column appears — a table nobody has pushed has nothing
   * to say in it.
   */
  results: Record<string, PushRowResult>
  /** A push is in flight: the rows it is creating must not change underneath it. */
  busy: boolean
  onGenerate: () => void
  onConfirmGenerate: () => void
  onCancelGenerate: () => void
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

const FIELD =
  'w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-content outline-none transition-colors placeholder:text-muted focus:border-accent'

/**
 * The bottom panel: what will be created in Linear, before it is created.
 *
 * Everything the model decided is editable except the two columns that exist to
 * be checked — the evidence line and the person the transcript named. Editing
 * those would defeat the point: they are the proof the task is real, and they
 * travel to Linear as the traceability block.
 */
export function TaskTable({
  state,
  results,
  busy,
  onGenerate,
  onConfirmGenerate,
  onCancelGenerate,
  onUpdateRow,
  onRemoveRow,
  onAddRow,
}: Props) {
  const rows = state?.rows ?? []
  const selected = rows.filter((row) => row.include).length
  const generating = state?.generating ?? false
  const changes = countManualChanges(state)
  // The column only exists once there is a push to report on; before that every
  // row would read «Pendiente», which says nothing.
  const showStatus = Object.keys(results).length > 0

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="panel-head justify-between gap-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="panel-title">Tareas</h2>
          {rows.length > 0 ? (
            <span className="chip tabular-nums">
              {selected} de {rows.length}
            </span>
          ) : null}
          {/* Says out loud what «Generar tareas» is about to ask about. */}
          {changes.total > 0 ? (
            <span className="chip border-warn/30 text-warn">{describeChanges(changes)}</span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onAddRow}
            disabled={!state || busy}
            className="rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium shadow-panel transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Añadir
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!state || generating || busy}
            className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent shadow-panel transition-colors hover:bg-accent-soft disabled:opacity-50 disabled:shadow-none"
          >
            {generating ? 'Generando…' : 'Generar tareas'}
          </button>
        </div>
      </header>

      {/* The list is recessed and every task is a card on it — the same figure
          against ground the file list gets from the panel it sits in. Cards on
          the plain surface would rely on a hairline alone, which is exactly
          what stopped working when four white columns met. */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2">
        {/* The error sits above the table and never replaces it: a failed
            regeneration must not throw away rows the user already curated. */}
        {state?.error ? (
          <p
            role="alert"
            className="border-b border-danger/30 bg-danger-wash px-4 py-3 text-sm text-danger"
          >
            {state.error}
          </p>
        ) : null}

        {generating && rows.length === 0 ? (
          <ExtractionProgress />
        ) : rows.length === 0 ? (
          <Empty extracted={state?.extracted ?? false} />
        ) : (
          // A list of stacked cards rather than a table. Seven columns need
          // roughly a thousand pixels before title and description stop being
          // slivers, and this panel is half a split pane — so the fields that
          // get edited take the full width, and the read-only ones (mentioned,
          // evidence, outcome) sit underneath where they cost no width at all.
          <ul className="flex flex-col gap-2 p-2">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                result={showStatus ? results[row.id] : undefined}
                showStatus={showStatus}
                busy={busy}
                onUpdate={(changes) => onUpdateRow(row.id, changes)}
                onRemove={() => onRemoveRow(row.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {state?.confirming ? (
        <ConfirmRegenerate
          changes={changes}
          onConfirm={onConfirmGenerate}
          onCancel={onCancelGenerate}
        />
      ) : null}
    </div>
  )
}

/**
 * The guard in front of a second extraction: it names what is about to be lost,
 * because the model's answer replaces the whole table and the edits are the
 * only thing on the page that cannot be recovered by pressing the button again.
 *
 * Cancelling does nothing at all — no state beyond the flag that opened this is
 * touched, which is what «leaves the current table untouched» means.
 */
function ConfirmRegenerate({
  changes,
  onConfirm,
  onCancel,
}: {
  changes: ManualChanges
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const lost =
    changes.total === 1
      ? 'Se perderá 1 cambio manual'
      : `Se perderán ${changes.total} cambios manuales`

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-scrim p-6">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="regenerate-title"
        aria-describedby="regenerate-body"
        className="w-full max-w-md rounded-lg border border-line bg-surface p-5 shadow-lg"
      >
        <h3
          id="regenerate-title"
          className="text-sm font-medium text-content"
        >
          ¿Regenerar y descartar los cambios manuales?
        </h3>
        <p id="regenerate-body" className="mt-2 text-sm text-muted">
          {`La nueva extracción reemplaza la tabla completa. ${lost} (${breakdown(changes)}).`}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:opacity-90"
          >
            Descartar y regenerar
          </button>
        </div>
      </div>
    </div>
  )
}

/** «3 cambios manuales», for the header. */
function describeChanges(changes: ManualChanges): string {
  return changes.total === 1 ? '1 cambio manual' : `${changes.total} cambios manuales`
}

/** «2 editadas, 1 añadida», so the number is checkable against the table. */
function breakdown(changes: ManualChanges): string {
  const parts: string[] = []
  if (changes.edited) parts.push(`${changes.edited} editada${changes.edited === 1 ? '' : 's'}`)
  if (changes.added) parts.push(`${changes.added} añadida${changes.added === 1 ? '' : 's'}`)
  if (changes.removed)
    parts.push(`${changes.removed} eliminada${changes.removed === 1 ? '' : 's'}`)
  return parts.join(', ')
}

function Row({
  row,
  result,
  showStatus,
  busy,
  onUpdate,
  onRemove,
}: {
  row: TaskDraft
  /** How this row ended in the last push; undefined means it is still pending. */
  result: PushRowResult | undefined
  showStatus: boolean
  busy: boolean
  onUpdate: (changes: Partial<TaskDraft>) => void
  onRemove: () => void
}) {
  // An excluded row stays legible but visibly out of the push: dimmed, and on
  // the recessed fill rather than on the card surface the included ones get.
  const label = row.title.trim() || 'tarea sin título'

  return (
    <li
      className={`rounded-xl border p-2.5 transition-colors ${
        row.include
          ? 'border-line bg-surface shadow-panel'
          : 'border-dashed border-line-strong bg-transparent opacity-60'
      }`}
    >
      {/* Checkbox and title on one line: including a row and naming it are the
          two things done most, so they sit at the top where the eye lands. */}
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={row.include}
          onChange={(event) => onUpdate({ include: event.target.checked })}
          disabled={busy}
          aria-label={`Incluir ${label}`}
          className="mt-2 h-4 w-4 shrink-0 accent-accent"
        />

        <input
          type="text"
          value={row.title}
          onChange={(event) => onUpdate({ title: event.target.value })}
          disabled={busy}
          aria-label="Título"
          placeholder="Título de la tarea"
          className={`${FIELD} min-w-0 flex-1 font-medium`}
        />

        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Eliminar ${label}`}
          title="Eliminar"
          className="mt-1 shrink-0 rounded-lg border border-transparent p-1.5 text-muted transition-colors hover:border-danger/40 hover:bg-danger-wash hover:text-danger"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="size-3.5"
            aria-hidden="true"
          >
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Everything below is indented to the title, so the checkbox column
          reads as a single gutter down the list. */}
      <div className="mt-2 flex flex-col gap-2 pl-6 pr-9">
        <textarea
          value={row.description}
          onChange={(event) => onUpdate({ description: event.target.value })}
          disabled={busy}
          aria-label="Descripción"
          rows={2}
          placeholder="Contexto de la tarea"
          className={`${FIELD} w-full resize-y`}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <select
            value={row.priority}
            onChange={(event) => onUpdate({ priority: event.target.value as Priority })}
            disabled={busy}
            aria-label="Prioridad"
            className={`${FIELD} w-auto`}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>

          {row.mentioned ? (
            <span className="chip">
              <span className="text-muted">@</span>
              <span className="text-content">{row.mentioned}</span>
            </span>
          ) : null}

          {showStatus ? (
            <span className="ml-auto">
              <RowStatus result={result} />
            </span>
          ) : null}
        </div>

        {/* The quote is the defence against an invented task, so it is visible
            rather than hidden behind a tooltip — but capped, because a long one
            would push the next task off the screen. */}
        {row.evidence ? (
          <q
            title={row.evidence}
            className="block max-h-16 overflow-y-auto rounded-r-md border-l-2 border-accent/30 bg-surface-2/70 py-1 pl-2 pr-1 text-xs italic leading-snug text-muted"
          >
            {row.evidence}
          </q>
        ) : (
          <span className="text-xs text-muted opacity-70">Añadida manualmente</span>
        )}
      </div>
    </li>
  )
}

/**
 * What the push did with this row. The three outcomes are the three things the
 * user can do next: follow the link, read the error and retry, or wait.
 *
 * A created issue is shown as its identifier linking to Linear, because that is
 * how the task is referred to from now on — and it is also the proof the row
 * does not need pushing again.
 */
function RowStatus({ result }: { result: PushRowResult | undefined }) {
  if (!result) {
    return <span className="chip">Pendiente</span>
  }

  if (result.state === 'creating') {
    return <span className="chip border-accent/30 text-accent">Creando…</span>
  }

  if (result.state === 'created') {
    const label = result.issue.identifier || 'Creada'
    const className = 'chip border-ok/30 bg-ok-wash font-medium text-ok'
    return result.issue.url ? (
      <a
        href={result.issue.url}
        target="_blank"
        rel="noreferrer"
        className={`${className} font-mono hover:underline`}
      >
        ✓ {label}
      </a>
    ) : (
      <span className={className}>✓ {label}</span>
    )
  }

  return (
    <span
      title={result.error}
      className="chip max-w-full border-danger/30 bg-danger-wash text-danger"
    >
      <span className="truncate">{result.error}</span>
    </span>
  )
}

/**
 * Nothing to show yet. Whether an extraction has run is the difference between
 * «press the button» and «the model found no commitments here».
 */
function Empty({ extracted }: { extracted: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="mb-3 flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-muted"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
        >
          <path d="M4 6h11M4 11h8M4 16h6" />
          <path d="m14 17 2.5 2.5L21 15" />
        </svg>
      </span>
      <p className="text-sm font-medium text-content">
        {extracted ? 'No se encontraron tareas en esta transcripción' : 'Aún no hay tareas'}
      </p>
      <p className="mt-1 max-w-xs text-sm text-muted">
        {extracted
          ? 'La transcripción no contiene compromisos claros. Puedes añadir una tarea manualmente.'
          : 'Pulsa «Generar tareas» para extraerlas de la transcripción, o añade una manualmente.'}
      </p>
    </div>
  )
}
