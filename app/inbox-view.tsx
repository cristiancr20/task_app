'use client'

import { useEffect, useMemo, useRef } from 'react'

import {
  extractButtonLabel,
  extractedTasksLabel,
  type QueueNoteResult,
  type QueueState,
  queueSummaryLabel,
  type QueueTally,
  queueTally,
} from '@/lib/extraction-queue-state'
import type { FilteredFiles } from '@/lib/file-filter'
import type { InboxCounts, InboxItem } from '@/lib/inbox'
import { noteSizeLabel } from '@/lib/inbox'
import { selectionCountLabel, selectionLimitLabel } from '@/lib/inbox-selection'
import type { InboxState } from '@/lib/inbox-state'
import { folderLabel } from '@/lib/note-paths'

import { QueueProgress } from './progress'
import type { ExtractionQueueApi } from './use-extraction-queue'
import type { InboxSelectionApi } from './use-inbox'

type Props = {
  /** Where the shared inbox stands — see `useInbox`. */
  state: InboxState
  /** How many are pending, and how many of those already have drafts. */
  counts: InboxCounts
  /** The context folder's own name, for the folder line of each row. */
  rootLabel: string
  /** The note open in the transcript column, if it is one of these rows. */
  selectedFile: string | null
  /** What the filter strip holds, and the rows it left on screen. */
  filter: string
  onFilterChange: (value: string) => void
  filtered: FilteredFiles<InboxItem>
  /** Which rows are ticked, and everything the bar needs to say about it. */
  selection: InboxSelectionApi
  /** The batch extraction: where it stands and how to stop it. */
  queue: ExtractionQueueApi
  /** «Extraer N notas»: launches the tanda over what is ticked right now. */
  onExtract: () => void
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
 *
 * The rows can be ticked, which is what turns the inbox from a list into a
 * pile that can be worked through in one go. Two rules hold the selection
 * together and are visible in the markup: «seleccionar todo» is drawn *beside
 * the filter*, because it means the rows that filter left; and the action bar
 * sits outside the scrolling area, so scrolling never takes away what has been
 * chosen or the thing that acts on it.
 */
export function InboxView({
  state,
  counts,
  rootLabel,
  selectedFile,
  filter,
  onFilterChange,
  filtered,
  selection,
  queue,
  onExtract,
  onOpen,
  onReload,
}: Props) {
  const { loading, loaded, error, truncated, scanned } = state
  const { files: items, active, total } = filtered
  const { summary } = selection

  // Which rows belong to the tanda that is running (or has just run), so a row
  // can show what happened to *it* rather than only what the bar says about
  // all of them. A set, because the tanda is looked up once per row.
  const inTanda = useMemo(
    () => new Set(queue.state.notes.map((note) => note.relPath)),
    [queue.state.notes],
  )
  const tally = useMemo(() => queueTally(queue.state), [queue.state])
  // Chosen notes that already carry drafts. Extracting them again replaces
  // what is there, edits included, and that is worth saying *before* the
  // button is pressed rather than after.
  const replacing = useMemo(
    () => selection.items.filter((item) => item.status === 'extracted').length,
    [selection.items],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="panel-head justify-between">
        <h2 className="panel-title">Bandeja</h2>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Nothing is claimed before the first answer: a `0 pendientes` on a
              panel that has not asked yet would read as «no queda nada». */}
          {loaded ? (
            <span className="chip shrink-0 tabular-nums">
              {active ? shownLabel(items.length, total) : countLabel(total)}
            </span>
          ) : null}
          <ReloadButton loading={loading} onClick={onReload} />
        </div>
      </header>

      {/* The strip appears once there are rows to narrow and to tick: a filter
          over nothing, and a «seleccionar todo» that would select nothing, are
          two controls that cannot do anything yet. */}
      {loaded && total > 0 ? (
        <div className="flex flex-col gap-1.5 border-b border-line px-2 py-1.5">
          <FilterField value={filter} onChange={onFilterChange} />
          <SelectAll
            /* Labelled with what it reaches, not with «todo»: with a filter on
               it only ever ticks the rows on screen, and saying so is cheaper
               than making the user find that out by pressing it. */
            label={active ? `Seleccionar las ${NUMBER.format(items.length)} filtradas` : 'Seleccionar todo'}
            checked={summary.allVisibleSelected}
            indeterminate={summary.someVisibleSelected}
            disabled={items.length === 0}
            onChange={selection.toggleVisible}
          />
        </div>
      ) : null}

      {/* One live region for the whole body: «cargando», «bandeja vacía» and
          the count all reach a screen reader as they replace each other. */}
      <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto p-2">
        {!loaded && loading ? (
          <p className="px-2 py-4 text-sm text-muted">Buscando notas sin procesar…</p>
        ) : error && total === 0 ? (
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
        ) : total === 0 ? (
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

            {items.length === 0 ? (
              // A list that empties itself without a word reads as a bandeja
              // that lost its notes: what happened is that *this* filter
              // matched none of them.
              <NoMatches filter={filter.trim()} total={total} onClear={() => onFilterChange('')} />
            ) : (
              // `buildInbox` already ordered them — most recent first, undated
              // last — so the rows are rendered as they arrive.
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <li key={item.relPath}>
                    <InboxRow
                      item={item}
                      rootLabel={rootLabel}
                      selected={item.relPath === selectedFile}
                      checked={selection.paths.has(item.relPath)}
                      /* A full tanda greys out what is *not* in it and leaves
                         what is alone: the way out of the limit has to keep
                         working, or the only escape would be the bar. */
                      disabled={
                        (summary.atLimit && !selection.paths.has(item.relPath)) ||
                        // A note the running tanda is going to reach is not
                        // available for another one: it is already spoken for.
                        (queue.busy && inTanda.has(item.relPath))
                      }
                      queued={inTanda.has(item.relPath)}
                      result={queue.state.results[item.relPath] ?? null}
                      onToggle={() => selection.toggle(item.relPath)}
                      onSelect={() => onOpen(item.relPath)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Outside the scrolling area on purpose: what is chosen and what can be
          done with it must not scroll away — and the bar is not there at all
          while nothing is chosen, so an empty selection costs no height. */}
      {summary.count > 0 ? (
        <SelectionBar
          count={summary.count}
          hidden={summary.count - summary.visibleSelected}
          atLimit={summary.atLimit}
          max={selection.max}
          replacing={replacing}
          busy={queue.busy}
          onExtract={onExtract}
          onClear={selection.clear}
        />
      ) : null}

      {/* The tanda outlives this view — it is run by the explorer around it —
          so coming back mid-run finds it exactly where it was, and the panel
          is simply absent while there is no tanda at all. */}
      {queue.state.status !== 'idle' ? (
        <QueueBar
          state={queue.state}
          tally={tally}
          onCancel={queue.cancel}
          onDismiss={queue.dismiss}
        />
      ) : null}
    </div>
  )
}

/**
 * What is chosen right now, what it is going to cost, and the two things that
 * can be done with it: extract it, or undo it.
 *
 * It appears with the first tick and goes away with the last, so its presence
 * is itself the answer to «¿tengo algo seleccionado?». The limit is explained
 * *here*, when it is reached, rather than on the box that refused: by then the
 * user has already pressed something that did nothing, and this is the only
 * place that can say why.
 *
 * «Extraer» is the primary action of the whole bandeja, so it is a full-width
 * button at the bottom of the bar rather than one more control in the row of
 * links above it. It refuses while a tanda is running and says which of the
 * two reasons it is: a local model cannot serve two extractions at once, so
 * queueing a second tanda would not make either finish sooner.
 */
function SelectionBar({
  count,
  hidden,
  atLimit,
  max,
  replacing,
  busy,
  onExtract,
  onClear,
}: {
  count: number
  /** Chosen notes the filter is currently hiding. */
  hidden: number
  atLimit: boolean
  max: number
  /** Chosen notes that already have drafts, which extracting would replace. */
  replacing: number
  /** A tanda is already running: this one cannot be launched on top of it. */
  busy: boolean
  onExtract: () => void
  onClear: () => void
}) {
  return (
    <div className="border-t border-line bg-surface-2 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" className="min-w-0 truncate text-sm font-medium text-content">
          {selectionCountLabel(count)}
          {/* Said only when it is true: a count that does not match the ticked
              boxes on screen is otherwise read as a bug. */}
          {hidden > 0 ? (
            <span className="font-normal text-muted"> ({hidden} fuera del filtro)</span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-surface"
        >
          No seleccionar nada
        </button>
      </div>

      {atLimit ? (
        <p className="mt-1.5 text-xs text-warn">
          {selectionLimitLabel(max)}. Quita alguna para elegir otra, o procesa esta tanda y sigue
          con el resto.
        </p>
      ) : null}

      {/* Said before the button, not after the fact: an extraction replaces the
          drafts of the note it runs on — the manual edits with them — and that
          is the one thing this button can destroy. */}
      {replacing > 0 ? (
        <p className="mt-1.5 text-xs text-warn">
          {replacing === 1
            ? '1 ya tiene borrador y se reemplazará con lo que salga ahora.'
            : `${NUMBER.format(replacing)} ya tienen borrador y se reemplazarán con lo que salga ahora.`}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onExtract}
        disabled={busy}
        title={busy ? 'Ya hay una tanda en curso' : undefined}
        className="mt-2 w-full rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-on-accent shadow-panel transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        {busy ? 'Hay una tanda en curso' : extractButtonLabel(count)}
      </button>
    </div>
  )
}

/**
 * The tanda itself: what is being extracted right now, or how it went.
 *
 * It sits below the selection bar and outside the scrolling area, because it
 * is about work that is happening rather than about the list — and because it
 * has to be readable while the rows underneath reload, which they do after
 * every note that lands.
 *
 * The summary stays until it is dismissed. A tanda of fifteen notes finishes
 * while the user is somewhere else in the app, and «así fue» is the one thing
 * they will come back for; making it vanish on its own would answer the
 * question only for whoever happened to be watching.
 */
function QueueBar({
  state,
  tally,
  onCancel,
  onDismiss,
}: {
  state: QueueState
  tally: QueueTally
  onCancel: () => void
  onDismiss: () => void
}) {
  const running = state.status === 'running' || state.status === 'cancelling'

  return (
    <div className="border-t border-line bg-surface-2 px-2.5 py-2">
      {running ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Extrayendo la tanda
            </p>
            <button
              type="button"
              onClick={onCancel}
              disabled={state.status === 'cancelling'}
              className="shrink-0 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-surface disabled:opacity-50"
            >
              {state.status === 'cancelling' ? 'Cancelando…' : 'Cancelar'}
            </button>
          </div>

          <div className="mt-1.5">
            {state.progress ? (
              <QueueProgress
                index={state.progress.index}
                total={state.progress.total}
                title={state.progress.title}
              />
            ) : (
              <p className="text-sm text-muted">Preparando la tanda…</p>
            )}
          </div>

          {/* The cancellation is not instant and pretending otherwise would be
              a lie the next minute exposes: the note in flight has already cost
              its time, so it is finished and kept. */}
          {state.status === 'cancelling' ? (
            <p className="mt-1.5 text-xs text-muted">
              Se detendrá al terminar esta nota; las demás no se lanzarán.
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-muted">
              Una nota cada vez. Puedes seguir leyendo o buscando mientras tanto.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p aria-live="polite" className="min-w-0 text-sm font-medium text-content">
              Tanda terminada
            </p>
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-surface"
            >
              Cerrar
            </button>
          </div>

          <p className="mt-0.5 text-xs tabular-nums text-muted">{queueSummaryLabel(tally)}</p>

          {/* Why it ended early, when it did. A cancellation carries no error
              because there was none: the user asked, and what had already been
              extracted is on disk. */}
          {state.stopped?.error ? (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {state.stopped.error}
            </p>
          ) : state.stopped?.reason === 'cancelled' ? (
            <p className="mt-1.5 text-xs text-muted">
              Cancelaste la tanda. Lo extraído está guardado; lo que faltaba sigue pendiente.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * «Seleccionar todo», with the three states a group checkbox has.
 *
 * `indeterminate` is a property, never an attribute, so it is written to the
 * node after every render: React has no prop for it and a box that is «algunas»
 * would otherwise be drawn as «ninguna».
 */
function SelectAll({
  label,
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  indeterminate: boolean
  disabled: boolean
  onChange: () => void
}) {
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (box.current) box.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <label className="flex w-fit items-center gap-2 px-0.5 text-xs text-muted">
      <input
        ref={box}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-3.5 w-3.5 shrink-0 accent-accent"
      />
      {label}
    </label>
  )
}

/**
 * One pending note: what it is, how far along it is, and where and how big.
 *
 * Built like a file row and like a search result on purpose — same edge mark
 * for the selection, same muted meta line — because it does the same thing: it
 * is how a note is opened.
 *
 * The tick box is a sibling of that button rather than inside it: two
 * independent actions on one row — «elígela para la tanda» and «ábrela» — and
 * a control nested in a button is neither valid markup nor reachable with a
 * keyboard.
 */
function InboxRow({
  item,
  rootLabel,
  selected,
  checked,
  disabled,
  queued,
  result,
  onToggle,
  onSelect,
}: {
  item: InboxItem
  rootLabel: string
  selected: boolean
  checked: boolean
  disabled: boolean
  /** This note belongs to the tanda on screen, whether or not it has run yet. */
  queued: boolean
  /** How the tanda went for this note; null while it has not been attempted. */
  result: QueueNoteResult | null
  onToggle: () => void
  onSelect: () => void
}) {
  const folder = folderLabel(rootLabel, item.folder)

  return (
    <div
      className={`relative flex items-start gap-2 rounded-lg py-2.5 pl-4 pr-3 transition-colors ${
        selected ? 'bg-accent-wash' : checked ? 'bg-surface-2' : 'hover:bg-surface-2'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-2 left-1.5 w-0.5 rounded-full transition-colors ${
          selected ? 'bg-accent' : 'bg-transparent'
        }`}
      />

      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        aria-label={`Seleccionar ${item.title}`}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent disabled:opacity-40"
      />

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? 'true' : undefined}
          className="block w-full min-w-0 text-left"
        >
          <span className="flex items-baseline gap-2">
            <span
              className={`min-w-0 flex-1 truncate text-sm text-content ${
                selected ? 'font-semibold' : 'font-medium'
              }`}
            >
              {item.title}
            </span>
            {/* The tanda's own mark wins over the status when there is one: it
                says everything the badge would and one thing more — how this
                note went, just now. Otherwise only the note that has been started
                carries a mark, because «sin tocar» is what the whole panel is
                about and a badge on every row would drown the one that matters. */}
            {result || queued ? (
              <QueueChip result={result} />
            ) : item.status === 'extracted' ? (
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

        {/* Outside the button, because it is not what pressing the row does: a
            note the tanda could not extract says why, right where it failed, so
            the queue's summary never has to be the only account of it. */}
        {result?.state === 'failed' ? (
          <p role="alert" className="mt-1 text-xs text-danger">
            {result.error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * What the tanda did to one note, as a chip beside its title.
 *
 * A note with no result yet is «en cola» rather than unmarked: it was chosen,
 * it is going to be extracted, and the difference between «esperando» and «no
 * la elegí» is the whole reason for ticking rows in the first place.
 */
function QueueChip({ result }: { result: QueueNoteResult | null }) {
  if (!result) {
    return (
      <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted">
        En cola
      </span>
    )
  }

  if (result.state === 'extracting') {
    return (
      <span className="shrink-0 animate-pulse rounded-full bg-accent px-1.5 py-0.5 text-[0.6875rem] font-medium text-on-accent">
        Extrayendo…
      </span>
    )
  }

  if (result.state === 'failed') {
    return (
      <span className="shrink-0 rounded-full bg-danger/10 px-1.5 py-0.5 text-[0.6875rem] font-medium text-danger">
        Falló
      </span>
    )
  }

  return (
    <span className="shrink-0 rounded-full bg-accent-wash px-1.5 py-0.5 text-[0.6875rem] font-medium tabular-nums text-accent">
      {extractedTasksLabel(result.tasks)}
    </span>
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
 * The filter of the bandeja, in the strip under its head.
 *
 * The same box as the file list's, and for the same reasons — no debounce, no
 * minimum length, no request, Escape to empty it — because it does the same
 * thing to a list already in memory. What differs is what it narrows: every
 * pending note under the root rather than one folder's listing.
 */
function FilterField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return
    // `type="search"` clears itself on Escape in some browsers without React
    // hearing about it, which would leave the field and the filter disagreeing.
    event.preventDefault()
    if (value) {
      onChange('')
    } else {
      input.current?.blur()
    }
  }

  return (
    <div className="relative">
      <FilterIcon />
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Filtrar la bandeja…"
        aria-label="Filtrar las notas pendientes"
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-lg border border-line bg-surface py-1 pl-7 pr-7 text-sm text-content outline-none placeholder:text-muted focus:border-accent [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange('')
            // Emptying the filter is a step inside it, not a way out: the
            // cursor stays where the next one is typed.
            input.current?.focus()
          }}
          title="Quitar el filtro (Esc)"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition-colors hover:bg-line hover:text-content"
        >
          <span className="sr-only">Quitar el filtro</span>
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      ) : null}
    </div>
  )
}

/** A funnel, so the box is not mistaken for the search up in the header. */
function FilterIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 3.5h11l-4.25 5v4l-2.5 1.25v-5.25z" />
    </svg>
  )
}

/** There are pending notes; this filter simply matches none of them. */
function NoMatches({
  filter,
  total,
  onClear,
}: {
  filter: string
  total: number
  onClear: () => void
}) {
  return (
    <div className="px-2 py-10 text-center">
      <p className="text-sm font-medium text-content">Ninguna nota coincide</p>
      <p className="mt-1 text-sm text-muted">
        {filter ? <>Nada pendiente contiene «{filter}». </> : null}
        Prueba con otras palabras o busca en todas las notas desde la cabecera.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2"
      >
        Quitar el filtro y ver{' '}
        {total === 1 ? 'la nota pendiente' : `las ${NUMBER.format(total)} pendientes`}
      </button>
    </div>
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

/** `3 de 12 pendientes`: the same count, with how much of it the filter shows. */
function shownLabel(shown: number, total: number): string {
  return `${NUMBER.format(shown)} de ${NUMBER.format(total)} ${total === 1 ? 'pendiente' : 'pendientes'}`
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
