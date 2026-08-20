'use client'

import { folderLabel, folderOfNote } from '@/lib/note-paths'
import { MIN_QUERY_LENGTH, type SearchResult } from '@/lib/search'
import { highlightParts, leadMatch, type SearchState } from '@/lib/search-state'

type Props = {
  /** Where the shared search stands — see `useSearch`. */
  state: SearchState
  /** The context folder's own name, for the folder line of each result. */
  rootLabel: string
  /** The note open in the transcript column, if it is one of these results. */
  selectedFile: string | null
  /** Open a result: the note in the transcript, its folder in the tree. */
  onOpen: (relPath: string) => void
  /** «Reintentar»: send the same query again. */
  onRetry: () => void
}

const NUMBER = new Intl.NumberFormat('es-ES')
const DATE = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The results of the header's search, in the column the folder's files
 * normally occupy.
 *
 * It replaces the file list rather than covering the page: the transcript
 * beside it stays exactly where it was, so emptying the field puts the user
 * back on the folder with the note they were reading still open.
 *
 * Every state the search can be in is worded here and each of them says
 * something different — looking, nothing found, and «this is not all there
 * is», which is the one a truncated answer would otherwise hide by looking
 * like a complete short list.
 */
export function SearchResults({ state, rootLabel, selectedFile, onOpen, onRetry }: Props) {
  const results = state.status === 'ready' ? state.results : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="panel-head justify-between">
        <h2 className="panel-title">Resultados</h2>
        {state.status === 'ready' ? (
          <span className="chip shrink-0 tabular-nums">{countLabel(results.length)}</span>
        ) : null}
      </header>

      {/* One live region for the whole body: «buscando», «sin resultados» and
          the count all reach a screen reader as they replace each other. */}
      <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto p-2">
        {state.status === 'idle' ? (
          <p className="px-2 py-4 text-sm text-muted">
            Escribe al menos {MIN_QUERY_LENGTH} caracteres para buscar.
          </p>
        ) : state.status === 'searching' ? (
          <p className="px-2 py-4 text-sm text-muted">Buscando «{state.query}»…</p>
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
        ) : results.length === 0 ? (
          <div className="px-2 py-10 text-center">
            <p className="text-sm font-medium text-content">Sin resultados</p>
            <p className="mt-1 text-sm text-muted">
              Ninguna nota dice «{state.query}». Prueba con menos palabras.
            </p>
          </div>
        ) : (
          <>
            {/* Said above the list, not below it: whoever stops reading after
                the third row still learns that the list has an end that is not
                the end of the matches. */}
            {state.truncated ? (
              <p className="mx-1 mb-2 rounded-lg border border-warn/30 bg-warn-wash px-2.5 py-2 text-xs text-warn">
                Hay más notas que dicen «{state.query}» de las que caben aquí. Añade alguna palabra
                para acotar la búsqueda.
              </p>
            ) : null}

            {/* `sortResults` already ordered them — most matches first, then
                the most recent — so the rows are rendered as they arrive. */}
            <ul className="flex flex-col gap-0.5">
              {results.map((result) => (
                <li key={result.relPath}>
                  <ResultRow
                    result={result}
                    rootLabel={rootLabel}
                    selected={result.relPath === selectedFile}
                    onSelect={() => onOpen(result.relPath)}
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
 * One note that matched: what it is, where it lives, and the sentence the
 * phrase was said in.
 *
 * The row is built like a file row on purpose — same edge mark for the
 * selection, same muted meta line — because it does the same thing: it is how
 * a note is opened. The excerpt is the one thing it adds.
 */
function ResultRow({
  result,
  rootLabel,
  selected,
  onSelect,
}: {
  result: SearchResult
  rootLabel: string
  selected: boolean
  onSelect: () => void
}) {
  const match = leadMatch(result)
  const folder = folderLabel(rootLabel, folderOfNote(result.relPath))

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
          {result.title}
        </span>
        {/* One excerpt is shown, so the count is how the row admits that the
            note says it more often than this. */}
        {result.matchCount > 1 ? (
          <span className="chip shrink-0 tabular-nums">
            {NUMBER.format(result.matchCount)} coincidencias
          </span>
        ) : null}
      </span>

      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
        {result.date ? <time dateTime={result.date}>{formatDate(result.date)}</time> : null}
        {result.date ? (
          <span aria-hidden="true" className="text-muted/50">
            ·
          </span>
        ) : null}
        <span className="min-w-0 truncate" title={folder}>
          {folder}
        </span>
      </span>

      {match ? <Snippet {...highlightParts(match)} /> : null}
    </button>
  )
}

/**
 * The excerpt, with the match marked.
 *
 * The three pieces arrive as plain strings and are rendered as text: nothing
 * a note contains can reach the page as markup, and the highlight sits exactly
 * on the characters the query matched — accents and all, even the ones the
 * search itself looked past.
 */
function Snippet({ before, hit, after }: { before: string; hit: string; after: string }) {
  return (
    <span className="mt-1.5 block text-xs leading-relaxed text-muted">
      …{before}
      <mark className="rounded bg-warn-wash px-0.5 font-medium text-content">{hit}</mark>
      {after}…
    </span>
  )
}

function countLabel(results: number): string {
  return results === 1 ? '1 resultado' : `${NUMBER.format(results)} resultados`
}

/** `2026-08-09` → `9 ago 2026`, read as a plain calendar day (no timezone shift). */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date)
}
