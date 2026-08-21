'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { inboxCounts, type InboxCounts } from '@/lib/inbox'
import { fetchInbox } from '@/lib/inbox-client'
import { INITIAL_INBOX, inboxReducer, type InboxState } from '@/lib/inbox-state'

export type InboxApi = {
  /** Whether the inbox is the view on screen instead of the explorer's columns. */
  open: boolean
  show: () => void
  hide: () => void
  state: InboxState
  /** How many are pending, and how many of those are already extracted. */
  counts: InboxCounts
  /** Walk the disk again — the reload button, and «Reintentar» after a failure. */
  reload: () => void
}

/**
 * The inbox as the whole page shares it: the button in the header opens it and
 * shows how many notes are pending, the view inside the explorer draws them,
 * and both are the same hook — see `app/inbox-provider.tsx`.
 *
 * It loads once on mount rather than on first open, because the count is part
 * of the header: a button that says «Bandeja» and only learns the number after
 * being pressed cannot tell the user there is anything waiting. The request is
 * cheap on the server — one cached walk, no transcript bodies — and it warms
 * the very index the search is about to use.
 *
 * Reloading forces the walk (`refresh`), which is the whole point of the
 * button: the index is there so the app does not re-read the disk, and this is
 * the one moment the user is explicitly asking it to.
 */
export function useInbox(): InboxApi {
  const [open, setOpen] = useState(false)
  const [state, dispatch] = useReducer(inboxReducer, INITIAL_INBOX)
  /** The request that left last. Its answer is the only one worth writing. */
  const token = useRef(0)

  const load = useCallback((refresh: boolean) => {
    const round = ++token.current
    dispatch({ type: 'started', token: round })

    fetchInbox({ refresh }).then(
      (response) => dispatch({ type: 'resolved', token: round, response }),
      (err: unknown) => dispatch({ type: 'failed', token: round, message: errorMessage(err) }),
    )
  }, [])

  // The first read serves the index rather than forcing a walk: on a page load
  // there is nothing to suspect is stale yet.
  useEffect(() => {
    load(false)
  }, [load])

  const counts = useMemo(() => inboxCounts(state.items), [state.items])
  const show = useCallback(() => setOpen(true), [])
  const hide = useCallback(() => setOpen(false), [])
  const reload = useCallback(() => load(true), [load])

  return { open, show, hide, state, counts, reload }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'No se pudo leer la bandeja de entrada.'
}
