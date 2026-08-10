'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { TranscriptView } from '@/lib/transcript-client'
import { fetchTranscript } from '@/lib/transcript-client'

/** What is known about the selected file: nothing, in flight, loaded, or failed. */
export type TranscriptState =
  | { status: 'loading' }
  | { status: 'ready'; transcript: TranscriptView }
  | { status: 'error'; message: string }

/**
 * Load the selected transcript, and load it again whenever the selection
 * changes.
 *
 * Unlike the folder listings this is deliberately *not* cached: the response
 * carries the push history, which changes while the page is open, so coming
 * back to a file must show what was created from it since.
 */
export function useTranscript(relPath: string | null): {
  state: TranscriptState | undefined
  reload: () => void
} {
  const [state, setState] = useState<TranscriptState | undefined>(undefined)
  // A slow response for a file that is no longer selected must not overwrite
  // the state of the one that is.
  const attempts = useRef(0)

  const load = useCallback((target: string | null) => {
    const attempt = ++attempts.current

    if (!target) {
      setState(undefined)
      return
    }

    setState({ status: 'loading' })

    const settle = (next: TranscriptState) => {
      if (attempts.current === attempt) setState(next)
    }

    fetchTranscript(target).then(
      (transcript) => settle({ status: 'ready', transcript }),
      (err: unknown) => settle({ status: 'error', message: errorMessage(err) }),
    )
  }, [])

  useEffect(() => {
    load(relPath)
  }, [load, relPath])

  const reload = useCallback(() => load(relPath), [load, relPath])

  return { state, reload }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'No se pudo leer el archivo.'
}
