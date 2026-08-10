'use client'

import type { HistoryEntry } from '@/lib/store'
import type { TranscriptView } from '@/lib/transcript-client'

import { Markdown } from './markdown'
import type { TranscriptState } from './use-transcript'

type Props = {
  /** The transcript being read, or undefined when no file is selected. */
  state: TranscriptState | undefined
  onRetry: () => void
}

const NUMBER = new Intl.NumberFormat('es-ES')
const DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' })

/** The right panel: the note's text, and what has already been created from it. */
export function TranscriptPreview({ state, onRetry }: Props) {
  if (!state) return <NoSelection />

  if (state.status === 'loading') {
    return (
      <p className="px-6 py-6 text-sm text-muted">Cargando transcripción…</p>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="px-6 py-6">
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
    )
  }

  return <Loaded transcript={state.transcript} />
}

function Loaded({ transcript }: { transcript: TranscriptView }) {
  const { meta, body, history } = transcript

  return (
    // The header stays put and only the text scrolls, so a long transcript
    // never pushes the layout out of the viewport.
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line px-6 py-4">
        <h2 className="text-base font-semibold text-content">{meta.title}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {meta.date ? <time dateTime={meta.date}>{formatDate(meta.date)}</time> : null}
          {meta.attendees.length > 0 ? <span>{meta.attendees.join(', ')}</span> : null}
          <span>~{NUMBER.format(meta.words)} palabras</span>
          <span className="font-mono">{meta.fileName}</span>
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {/* The notice sits above the text: whether the file was already pushed
            changes what the user does with it. */}
        {history.length > 0 ? <ProcessedNotice history={history} /> : null}

        {body.trim() ? (
          <article className="max-w-3xl text-content">
            <Markdown source={body} />
          </article>
        ) : (
          <p className="text-sm text-muted">
            Este archivo no tiene contenido más allá de su frontmatter.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * «Ya creaste tareas desde este archivo»: how many, when, and a link to each
 * issue. Entries are stored oldest first and shown newest first, since the last
 * push is the one that explains the current state of the file.
 */
function ProcessedNotice({ history }: { history: HistoryEntry[] }) {
  const entries = [...history].reverse()
  const total = history.reduce((count, entry) => count + entry.issues.length, 0)
  const latest = entries[0]

  return (
    // A note rather than an `aside`: the explorer already has one complementary
    // landmark (the folder panel) and a second unlabelled one only adds noise.
    <div
      role="note"
      className="mb-6 max-w-3xl rounded-lg border border-warn/30 bg-warn-wash px-4 py-3"
    >
      <p className="text-sm font-medium text-warn">
        {total === 1 ? '1 tarea creada' : `${NUMBER.format(total)} tareas creadas`}{' '}
        {history.length > 1
          ? `en ${history.length} envíos, el último el ${formatPushedAt(latest.pushedAt)}`
          : `el ${formatPushedAt(latest.pushedAt)}`}
      </p>

      {entries.map((entry, key) => (
        <div key={key} className="mt-2">
          {/* With a single push the date is already in the line above. */}
          {history.length > 1 ? (
            <p className="text-xs text-muted">
              {formatPushedAt(entry.pushedAt)}
            </p>
          ) : null}
          <ul className="mt-1 flex flex-col gap-1">
            {entry.issues.map((issue) => (
              <li key={issue.id} className="text-sm">
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-warn underline underline-offset-2 hover:text-content"
                >
                  <span className="font-mono text-xs">{issue.identifier}</span>{' '}
                  <span>{issue.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function NoSelection() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
      <div>
        <p className="text-sm font-medium text-content">
          Elige un archivo para leerlo
        </p>
        <p className="mt-1 text-sm text-muted">
          Su contenido aparecerá aquí, junto con las tareas que ya hayas creado desde él.
        </p>
      </div>
    </div>
  )
}

/** `2026-08-09` → `9 ago 2026`, read as a plain calendar day (no timezone shift). */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? iso : DAY.format(date)
}

/**
 * `pushedAt` is a full timestamp, so — unlike a date-only string — it is safe
 * to let `Date` parse it and render it in the user's own timezone.
 */
function formatPushedAt(pushedAt: string): string {
  const date = new Date(pushedAt)
  if (Number.isNaN(date.getTime())) return pushedAt
  return `${DAY.format(date)} a las ${TIME.format(date)}`
}
