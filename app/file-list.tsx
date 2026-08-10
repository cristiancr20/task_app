'use client'

import type { TranscriptMeta } from '@/lib/transcripts'

import type { FolderState } from './use-folder-listings'

type Props = {
  /** The listing of the selected folder, or undefined before it is asked for. */
  state: FolderState | undefined
  /** Human path of the selected folder, e.g. `notas / 2026 / agosto`. */
  breadcrumb: string
  selectedFile: string | null
  onSelectFile: (relPath: string) => void
  onRetry: () => void
}

const NUMBER = new Intl.NumberFormat('es-ES')
const DATE = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

/** How many attendees fit on a row before the rest collapse into a `+N`. */
const MAX_ATTENDEES = 3

/** The `.md` files of the selected folder, one row each. */
export function FileList({ state, breadcrumb, selectedFile, onSelectFile, onRetry }: Props) {
  const files = state?.status === 'ready' ? state.listing.files : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-baseline justify-between gap-4 border-b border-line px-5 py-3">
        <h2 className="truncate text-sm font-medium text-content" title={breadcrumb}>
          {breadcrumb}
        </h2>
        {state?.status === 'ready' ? (
          <span className="shrink-0 text-xs text-muted">
            {files.length === 1 ? '1 archivo' : `${NUMBER.format(files.length)} archivos`}
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
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
              className="mt-3 rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              Reintentar
            </button>
          </div>
        ) : files.length === 0 ? (
          <EmptyFolder hasSubfolders={state.listing.folders.length > 0} />
        ) : (
          // `listFolder` already sorts by date descending and then by title, so
          // the rows are rendered in the order they arrive.
          <ul className="flex flex-col gap-1">
            {files.map((file) => (
              <li key={file.relPath}>
                <FileRow
                  file={file}
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

function FileRow({
  file,
  selected,
  onSelect,
}: {
  file: TranscriptMeta
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'border-accent bg-accent-wash'
          : 'border-transparent hover:bg-surface-2'
      }`}
    >
      <span className="block truncate text-sm font-medium text-content">
        {file.title}
      </span>

      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {/* Date and attendees only exist for files that declare them. */}
        {file.date ? <time dateTime={file.date}>{formatDate(file.date)}</time> : null}
        {file.attendees.length > 0 ? <span>{attendeesLabel(file.attendees)}</span> : null}
        <span>~{NUMBER.format(file.words)} palabras</span>
      </span>
    </button>
  )
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

function attendeesLabel(attendees: string[]): string {
  const shown = attendees.slice(0, MAX_ATTENDEES).join(', ')
  const rest = attendees.length - MAX_ATTENDEES
  return rest > 0 ? `${shown} +${rest}` : shown
}
