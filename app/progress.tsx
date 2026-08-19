'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Progress indicators for the two long operations in the app.
 *
 * They exist because both used to render a single line of static text, which
 * reads as a frozen UI: extraction runs a local 8B model over a whole
 * transcript and can take the better part of a minute, and a push is one HTTP
 * round trip per issue. Motion plus a number is the difference between "it is
 * working" and "it has hung".
 */

/** Seconds since mount, ticking every second. */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0)
  const startedAt = useRef(Date.now())

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return seconds
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * Extraction has no measurable progress: it is one model call that either
 * returns or does not. So the bar slides rather than fills, and the elapsed
 * counter carries the real signal — a number that keeps moving is proof the
 * request is alive, which a looping animation alone cannot give.
 */
export function ExtractionProgress({ model }: { model?: string }) {
  const seconds = useElapsedSeconds()

  return (
    <div className="px-5 py-6" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm text-content">Extrayendo tareas de la transcripción…</p>
        <p className="shrink-0 text-sm tabular-nums text-muted">{formatElapsed(seconds)}</p>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line">
        <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-accent" />
      </div>

      <p className="mt-2 text-xs text-muted">
        {model ? `El modelo ${model} está leyendo la transcripción entera. ` : ''}
        Un modelo local puede tardar cerca de un minuto en transcripciones largas.
      </p>
    </div>
  )
}

/**
 * A push does have a denominator, so the bar fills. `index` is 1-based and can
 * momentarily exceed nothing — it is clamped anyway, because a bar that
 * overshoots its track looks broken even when the numbers behind it are right.
 */
export function PushProgress({ index, total }: { index: number; total: number }) {
  const seconds = useElapsedSeconds()
  const safeTotal = Math.max(total, 1)
  const current = Math.min(Math.max(index, 1), safeTotal)
  const percent = Math.round((current / safeTotal) * 100)

  return (
    <div role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm text-content">{`Creando ${current} de ${safeTotal}…`}</p>
        <p className="shrink-0 text-sm tabular-nums text-muted">{formatElapsed(seconds)}</p>
      </div>

      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={current}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
