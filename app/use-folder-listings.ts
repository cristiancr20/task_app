'use client'

import { useCallback, useRef, useState } from 'react'

import { fetchFolder } from '@/lib/browse-client'
import type { FolderListing } from '@/lib/transcripts'

/** What is known about one folder: nothing yet, in flight, loaded, or failed. */
export type FolderState =
  | { status: 'loading' }
  | { status: 'ready'; listing: FolderListing }
  | { status: 'error'; message: string }

export type FolderListings = {
  /** Every folder that has been asked for, keyed by root-relative path. */
  states: Record<string, FolderState>
  /** Fetch a folder unless it has already been asked for. Safe to call on every click. */
  open: (relPath: string) => void
  /** Fetch a folder again whatever its current state — the «Reintentar» button. */
  reload: (relPath: string) => void
}

/**
 * The explorer's cache of `/api/browse` responses.
 *
 * One listing serves both panels: the tree reads `folders` from it and the file
 * list reads `files`, so expanding or selecting a folder costs a single request
 * and never repeats it.
 */
export function useFolderListings(): FolderListings {
  const [states, setStates] = useState<Record<string, FolderState>>({})
  const requested = useRef(new Set<string>())
  // A folder can be reloaded while a previous request for it is still running;
  // only the newest one is allowed to write its result.
  const latest = useRef(new Map<string, number>())

  const reload = useCallback((relPath: string) => {
    requested.current.add(relPath)
    const attempt = (latest.current.get(relPath) ?? 0) + 1
    latest.current.set(relPath, attempt)

    setStates((prev) => ({ ...prev, [relPath]: { status: 'loading' } }))

    const settle = (state: FolderState) => {
      if (latest.current.get(relPath) !== attempt) return
      setStates((prev) => ({ ...prev, [relPath]: state }))
    }

    fetchFolder(relPath).then(
      (listing) => settle({ status: 'ready', listing }),
      (err: unknown) => settle({ status: 'error', message: errorMessage(err) }),
    )
  }, [])

  const open = useCallback(
    (relPath: string) => {
      if (requested.current.has(relPath)) return
      reload(relPath)
    },
    [reload],
  )

  return { states, open, reload }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'No se pudo leer la carpeta.'
}
