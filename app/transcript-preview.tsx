'use client'

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

/** The right panel: the note the user is reading, and nothing else. */
export function TranscriptPreview({ state, onRetry }: Props) {
  return (
    // The panel is named whatever it holds — empty, loading or read: three
    // columns side by side each say what they are, and one of them dropping its
    // header when nothing is selected reads as a panel that broke.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="panel-head">
        <h2 className="panel-title">Transcripción</h2>
        {state?.status === 'ready' ? (
          <span
            className="chip ml-auto min-w-0 shrink font-mono"
            title={state.transcript.meta.fileName}
          >
            <span className="truncate">{state.transcript.meta.fileName}</span>
          </span>
        ) : null}
      </div>

      {!state ? (
        <NoSelection />
      ) : state.status === 'loading' ? (
        <p className="px-6 py-6 text-sm text-muted">Cargando transcripción…</p>
      ) : state.status === 'error' ? (
        <div className="px-6 py-6">
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
      ) : (
        <Loaded transcript={state.transcript} />
      )}
    </div>
  )
}

function Loaded({ transcript }: { transcript: TranscriptView }) {
  const { meta, body } = transcript

  return (
    // The header stays put and only the text scrolls, so a long transcript
    // never pushes the layout out of the viewport.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The note's own title block, on the reading surface rather than in the
          panel head: it belongs to the text, not to the chrome around it. */}
      <header className="border-b border-line px-6 pb-4 pt-5">
        <h3 className="text-lg font-semibold leading-tight tracking-tight text-content">
          {meta.title}
        </h3>
        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          {meta.date ? (
            <time dateTime={meta.date} className="chip">
              {formatDate(meta.date)}
            </time>
          ) : null}
          <span className="chip tabular-nums">{NUMBER.format(meta.words)} palabras</span>
          {meta.attendees.length > 0 ? (
            <span className="chip min-w-0" title={meta.attendees.join(', ')}>
              <span className="truncate">{meta.attendees.join(', ')}</span>
            </span>
          ) : null}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {/* Nothing but the note here. What has already been created from it is
            reported in the Linear column (see `PushedHistory`), where it is
            about the same thing as the panel around it — and where it is not
            covering the first screenful of every note already pushed. */}
        {body.trim() ? (
          <article className="max-w-3xl text-[0.9375rem] leading-7 text-content">
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

function NoSelection() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
      <div>
        <p className="text-sm font-medium text-content">
          Elige un archivo para leerlo
        </p>
        <p className="mt-1 text-sm text-muted">
          Su contenido aparecerá aquí, y a la derecha las tareas que salgan de él.
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

