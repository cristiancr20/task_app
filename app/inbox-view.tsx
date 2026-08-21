'use client'

import type { InboxCounts, InboxItem } from '@/lib/inbox'
import { noteSizeLabel } from '@/lib/inbox'
import type { InboxState } from '@/lib/inbox-state'
import { folderLabel } from '@/lib/note-paths'

type Props = {
  /** Where the shared inbox stands — see `useInbox`. */
  state: InboxState
  /** How many are pending, and how many of those already have drafts. */
  counts: InboxCounts
  /** The context folder's own name, for the folder line of each row. */
  rootLabel: string
  /** The note open in the transcript column, if it is one of these rows. */
  selectedFile: string | null
  /** Open a pending note: the note in the transcript, its folder in the tree. */
  onOpen: (relPath: string) => void
  /** Walk the disk again — the reload control, and «Reintentar» after a failure. */
  onReload: () => void
}

const NUMBER = new Intl.NumberFormat('es-ES')
const DATE = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The inbox, in the column the folder's files normally occupy: every note under
 * the root that has never been pushed, most recent first.
 *
 * It takes the place of the file list for the same reason the search does — the
 * transcript beside it stays exactly where it was, so opening a pending note
 * does not cost the list, and the next one is one click away. Closing the
 * inbox comes back to the folder with that note still open.
 *
 * The three things it must never do quietly are all worded here: an empty
 * inbox says it is empty *and why* instead of drawing a table with no rows, a
 * walk that hit its limit says so instead of passing for the whole folder, and
 * a note with drafts is marked rather than mixed in with the untouched ones —
 * they are both pending, but the next step is not the same.
 */
export function InboxView({
  state,
  counts,
  rootLabel,
  selectedFile,
  onOpen,
  onReload,
}: Props) {
  const { items, loading, loaded, error, truncated, scanned } = state

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="panel-head justify-between">
        <h2 className="panel-title">Bandeja</h2>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Nothing is claimed before the first answer: a `0 pendientes` on a
              panel that has not asked yet would read as «no queda nada». */}
          {loaded ? (
            <span className="chip shrink-0 tabular-nums">{countLabel(counts.total)}</span>
          ) : null}
          <ReloadButton loading={loading} onClick={onReload} />
        </div>
      </header>

      {/* One live region for the whole body: «cargando», «bandeja vacía» and
          the count all reach a screen reader as they replace each other. */}
      <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto p-2">
        {!loaded && loading ? (
          <p className="px-2 py-4 text-sm text-muted">Buscando notas sin procesar…</p>
        ) : error && items.length === 0 ? (
          <div className="px-2 py-4">
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
            <button
              type="button"
              onClick={onReload}
              className="mt-3 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              Reintentar
            </button>
          </div>
        ) : items.length === 0 ? (
          <EmptyInbox scanned={scanned} loaded={loaded} />
        ) : (
          <>
            {/* A reload that failed over a list that is still on screen is an
                error *about* that list, not the loss of it: it is reported
                above the rows, which are the previous — still true — answer. */}
            {error ? (
              <p
                role="alert"
                className="mx-1 mb-2 rounded-lg border border-danger/30 px-2.5 py-2 text-xs text-danger"
              >
                {error} La lista es la de la última vez que se pudo leer.
              </p>
            ) : null}

            {/* Said above the rows, not below them: whoever stops reading after
                the third one still learns that this list has an end that is not
                the end of the folder. */}
            {truncated ? (
              <p className="mx-1 mb-2 rounded-lg border border-warn/30 bg-warn-wash px-2.5 py-2 text-xs text-warn">
                El recorrido de la carpeta alcanzó su límite, así que puede haber más notas sin
                procesar de las que se ven aquí. Reparte las notas en subcarpetas o archiva las
                antiguas.
              </p>
            ) : null}

            {counts.extracted > 0 ? (
              <p className="mx-1 mb-2 px-1 text-xs text-muted">
                {extractedLabel(counts.extracted)} · {NUMBER.format(scanned)} notas en la carpeta
              </p>
            ) : null}

            {/* `buildInbox` already ordered them — most recent first, undated
                last — so the rows are rendered as they arrive. */}
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={item.relPath}>
                  <InboxRow
                    item={item}
                    rootLabel={rootLabel}
                    selected={item.relPath === selectedFile}
                    onSelect={() => onOpen(item.relPath)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * One pending note: what it is, how far along it is, and where and how big.
 *
 * Built like a file row and like a search result on purpose — same edge mark
 * for the selection, same muted meta line — because it does the same thing: it
 * is how a note is opened.
 */
function InboxRow({
  item,
  rootLabel,
  selected,
  onSelect,
}: {
  item: InboxItem
  rootLabel: string
  selected: boolean
  onSelect: () => void
}) {
  const folder = folderLabel(rootLabel, item.folder)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`relative w-full rounded-lg py-2.5 pl-4 pr-3 text-left transition-colors ${
        selected ? 'bg-accent-wash' : 'hover:bg-surface-2'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-2 left-1.5 w-0.5 rounded-full transition-colors ${
          selected ? 'bg-accent' : 'bg-transparent'
        }`}
      />

      <span className="flex items-baseline gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-sm text-content ${
            selected ? 'font-semibold' : 'font-medium'
          }`}
        >
          {item.title}
        </span>
        {/* Only the note that has been started carries a mark. «Sin tocar» is
            the ordinary case and the whole panel is already about it, so a
            badge on every row would say nothing and drown the one that does. */}
        {item.status === 'extracted' ? (
          <span className="shrink-0 rounded-full bg-accent-wash px-1.5 py-0.5 text-[0.6875rem] font-medium text-accent">
            Con borrador
          </span>
        ) : null}
      </span>

      {/* One line, not a wrapping one: the folder is the only part that can be
          arbitrarily long, so it is the part that truncates. Letting the row
          wrap instead put the size on a second line and left a separator
          dangling at the end of the first. */}
      <span className="mt-1 flex items-center gap-x-1.5 text-xs text-muted">
        {/* An undated note says so rather than leaving a gap where every other
            row has a day: it is «no consta», and it is why it sorts last. */}
        {item.date ? (
          <time dateTime={item.date} className="shrink-0">
            {formatDate(item.date)}
          </time>
        ) : (
          <span className="shrink-0">Sin fecha</span>
        )}
        <Separator />
        <span className="min-w-0 truncate" title={folder}>
          {folder}
        </span>
        <Separator />
        <span className="shrink-0 tabular-nums">{noteSizeLabel(item.words)}</span>
      </span>
    </button>
  )
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-muted/50">
      ·
    </span>
  )
}

/**
 * Nothing pending, said as an end rather than as an empty table.
 *
 * The two ways of having nothing are not the same thing and are not worded the
 * same: a folder with notes in it and none of them left is work finished, a
 * folder with no notes at all is a folder nobody has put anything in yet.
 */
function EmptyInbox({ scanned, loaded }: { scanned: number; loaded: boolean }) {
  if (!loaded) {
    return <p className="px-2 py-4 text-sm text-muted">Buscando notas sin procesar…</p>
  }

  return (
    <div className="px-2 py-10 text-center">
      <span aria-hidden="true" className="text-2xl">
        {scanned > 0 ? '✓' : '·'}
      </span>
      {scanned > 0 ? (
        <>
          <p className="mt-2 text-sm font-medium text-content">Bandeja vacía</p>
          <p className="mt-1 text-sm text-muted">
            Las {NUMBER.format(scanned)} notas de la carpeta ya se enviaron a Linear.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium text-content">No hay notas</p>
          <p className="mt-1 text-sm text-muted">
            La carpeta de contexto no contiene ningún archivo <code>.md</code>.
          </p>
        </>
      )}
    </div>
  )
}

/**
 * The rebuild control: walk the disk again instead of answering from the index.
 *
 * It stays enabled while a reload is in flight — pressing it again is a newer
 * request, and the reducer already drops the older answer — but it says what it
 * is doing, because the rows do not move until the new walk lands.
 */
function ReloadButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Volver a recorrer la carpeta para ver notas recién añadidas"
      className="rounded-md p-1 text-muted transition-colors hover:bg-line hover:text-content"
    >
      <span className="sr-only">{loading ? 'Actualizando la bandeja' : 'Actualizar la bandeja'}</span>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
        <polyline points="13.5,2 13.5,5 10.5,5" />
      </svg>
    </button>
  )
}

/** `12 pendientes`: what is left to process, for the panel head. */
function countLabel(total: number): string {
  return total === 1 ? '1 pendiente' : `${NUMBER.format(total)} pendientes`
}

/** `3 con borrador`: how many of the pending notes have already been extracted. */
function extractedLabel(extracted: number): string {
  return extracted === 1 ? '1 con borrador' : `${NUMBER.format(extracted)} con borrador`
}

/** `2026-08-09` → `9 ago 2026`, read as a plain calendar day (no timezone shift). */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date)
}
