'use client'

import type { FileView } from '@/lib/browse-client'
import type { IssueState } from '@/lib/linear'
import { type PushedProgress, pushedProgress } from '@/lib/pushed-progress'
import type { PushSummary } from '@/lib/store'

import type { FolderState } from './use-folder-listings'

type Props = {
  /** The listing of the selected folder, or undefined before it is asked for. */
  state: FolderState | undefined
  /** Human path of the selected folder, e.g. `notas / 2026 / agosto`. */
  breadcrumb: string
  /**
   * What Linear says today about the issues of each already-pushed note of this
   * folder — see `useFolderIssueStates`. A note that is missing from it is a
   * note nothing is known about yet, and its badge says only what it always did.
   */
  issueStates: Record<string, IssueState[]>
  selectedFile: string | null
  onSelectFile: (relPath: string) => void
  onRetry: () => void
}

const NUMBER = new Intl.NumberFormat('es-ES')
const DATE = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' })

/** How many attendees fit on a row before the rest collapse into a `+N`. */
const MAX_ATTENDEES = 3

/** The `.md` files of the selected folder, one row each. */
export function FileList({
  state,
  breadcrumb,
  issueStates,
  selectedFile,
  onSelectFile,
  onRetry,
}: Props) {
  const files = state?.status === 'ready' ? state.listing.files : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="panel-head justify-between">
        <h2 className="min-w-0 truncate" title={breadcrumb}>
          <Breadcrumb path={breadcrumb} />
        </h2>
        {state?.status === 'ready' ? (
          <span className="chip shrink-0 tabular-nums">
            {files.length === 1 ? '1 archivo' : `${NUMBER.format(files.length)} archivos`}
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!state || state.status === 'loading' ? (
          <p className="px-2 py-4 text-sm text-muted">Cargando archivos…</p>
        ) : state.status === 'error' ? (
          <div className="px-2 py-4">
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              Reintentar
            </button>
          </div>
        ) : files.length === 0 ? (
          <EmptyFolder hasSubfolders={state.listing.folders.length > 0} />
        ) : (
          // `listFolder` already sorts by date descending and then by title, so
          // the rows are rendered in the order they arrive.
          <ul className="flex flex-col gap-0.5">
            {files.map((file) => (
              <li key={file.relPath}>
                <FileRow
                  file={file}
                  states={issueStates[file.relPath]}
                  selected={file.relPath === selectedFile}
                  onSelect={() => onSelectFile(file.relPath)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * `raíz / notas / agosto`, with the folder being listed carrying the weight —
 * the path above it is context, and reading it in full every time is not what
 * the header is for.
 */
function Breadcrumb({ path }: { path: string }) {
  const segments = path.split(' / ')
  const last = segments.length - 1

  return (
    <span className="flex items-center gap-1 text-xs">
      {segments.map((segment, at) => (
        <span key={at} className="flex shrink-0 items-center gap-1">
          {at > 0 ? <span className="text-muted/60">/</span> : null}
          <span
            className={
              at === last ? 'font-semibold text-content' : 'truncate text-muted'
            }
          >
            {segment}
          </span>
        </span>
      ))}
    </span>
  )
}

function FileRow({
  file,
  states,
  selected,
  onSelect,
}: {
  file: FileView
  /** Linear's answer about this note's issues, or undefined while unknown. */
  states: IssueState[] | undefined
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`relative w-full rounded-lg py-2.5 pl-4 pr-3 text-left transition-colors ${
        selected ? 'bg-accent-wash' : 'hover:bg-surface-2'
      }`}
    >
      {/* The selected row is marked on its edge rather than by a full outline:
          the list is scanned vertically, and a bar down the side is what the
          eye follows back to its place after reading the transcript. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-2 left-1.5 w-0.5 rounded-full transition-colors ${
          selected ? 'bg-accent' : 'bg-transparent'
        }`}
      />

      {/* The badge keeps its full width and the title gives way, so a long
          title never pushes «ya creadas» off the row. */}
      <span className="flex items-baseline gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            selected ? 'font-semibold text-content' : 'font-medium text-content'
          }`}
        >
          {file.title}
        </span>
        {file.pushed ? <PushedBadge pushed={file.pushed} states={states} /> : null}
      </span>

      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
        {/* Date and attendees only exist for files that declare them. */}
        {file.date ? <time dateTime={file.date}>{formatDate(file.date)}</time> : null}
        {file.attendees.length > 0 ? (
          <>
            <Dot />
            <span className="truncate">{attendeesLabel(file.attendees)}</span>
          </>
        ) : null}
        {file.date || file.attendees.length > 0 ? <Dot /> : null}
        <span className="tabular-nums">{NUMBER.format(file.words)} palabras</span>
      </span>
    </button>
  )
}

/** The separator between two facts on the meta line. */
function Dot() {
  return (
    <span aria-hidden="true" className="text-muted/50">
      ·
    </span>
  )
}

/**
 * «Ya se crearon tareas desde este archivo», in the space a list row can spare:
 * a tick and the count — and, once Linear has answered, how many of those tasks
 * are already closed. The full sentence — how many are closed, how many pushes
 * and when the last one was — is the row's tooltip, and the same words reach a
 * screen reader through the visually hidden text, which `title` alone does not
 * guarantee.
 *
 * The count is what the badge is built around, so the states only ever *finish*
 * it: `5 tareas` becomes `3/5 tareas` in place, and a row never blinks through a
 * placeholder while the folder's query travels.
 *
 * A meeting with nothing left open wears the ok colour instead of the warn one,
 * which is the whole point of the badge in a list: what is still coming back
 * keeps the same amber as the notice inside the note, and what is finished stops
 * asking for attention. The colour is never the only difference — `5/5` says it
 * too, for whoever does not see the two apart.
 */
function PushedBadge({
  pushed,
  states,
}: {
  pushed: PushSummary
  states: IssueState[] | undefined
}) {
  const progress = pushedProgress(pushed.issues, states)

  return (
    <span
      title={badgeTitle(pushed, progress)}
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${
        progress?.done ? 'border-ok/30 bg-ok-wash text-ok' : 'border-warn/30 bg-warn-wash text-warn'
      }`}
    >
      <span aria-hidden="true">✓ </span>
      {progress ? closedLabel(progress) : createdLabel(pushed.issues)}
      <span className="sr-only">
        {progress ? ' cerradas de las creadas en Linear' : ' ya creadas en Linear'}
      </span>
    </span>
  )
}

/** What the row says before Linear has been asked: how much this note produced. */
function createdLabel(issues: number): string {
  return issues === 1 ? '1 tarea' : `${NUMBER.format(issues)} tareas`
}

/** `3/5 tareas`, once it is known — the same count, with how far along it is. */
function closedLabel({ closed, total }: PushedProgress): string {
  const count = `${NUMBER.format(closed)}/${NUMBER.format(total)}`
  return total === 1 ? `${count} tarea` : `${count} tareas`
}

/**
 * The tooltip: the progress first, because it is the news, and then the record
 * of the push that produced it.
 */
function badgeTitle(pushed: PushSummary, progress: PushedProgress | null): string {
  if (!progress) return pushedTitle(pushed)
  const closed = progress.done
    ? 'Todas las tareas están cerradas'
    : `${NUMBER.format(progress.closed)} de ${NUMBER.format(progress.total)} tareas cerradas`
  return `${closed} · ${pushedTitle(pushed)}`
}

function pushedTitle({ issues, pushes, lastPushedAt }: PushSummary): string {
  const count = issues === 1 ? '1 tarea creada' : `${NUMBER.format(issues)} tareas creadas`
  return pushes > 1
    ? `${count} en ${pushes} envíos, el último el ${formatPushedAt(lastPushedAt)}`
    : `${count} el ${formatPushedAt(lastPushedAt)}`
}

function EmptyFolder({ hasSubfolders }: { hasSubfolders: boolean }) {
  return (
    <div className="px-2 py-10 text-center">
      <p className="text-sm font-medium text-content">
        Esta carpeta no tiene archivos .md
      </p>
      <p className="mt-1 text-sm text-muted">
        {hasSubfolders
          ? 'Elige una subcarpeta en el árbol de la izquierda.'
          : 'Añade transcripciones en Markdown o elige otra carpeta.'}
      </p>
    </div>
  )
}

/** `2026-08-09` → `9 ago 2026`, read as a plain calendar day (no timezone shift). */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date)
}

/**
 * `pushedAt` is a full timestamp, so — unlike a date-only string — it is safe
 * to let `Date` parse it and render it in the user's own timezone.
 */
function formatPushedAt(pushedAt: string): string {
  const date = new Date(pushedAt)
  if (Number.isNaN(date.getTime())) return pushedAt
  return `${DATE.format(date)} a las ${TIME.format(date)}`
}

function attendeesLabel(attendees: string[]): string {
  const shown = attendees.slice(0, MAX_ATTENDEES).join(', ')
  const rest = attendees.length - MAX_ATTENDEES
  return rest > 0 ? `${shown} +${rest}` : shown
}
