'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import { prepareQuery } from '@/lib/search'
import { fetchSearch } from '@/lib/search-client'
import {
  IDLE_SEARCH,
  SEARCH_DEBOUNCE_MS,
  searchReducer,
  type SearchState,
} from '@/lib/search-state'

export type SearchApi = {
  /** Exactly what is in the field, including the spaces the user typed. */
  query: string
  setQuery: (query: string) => void
  /** Empty the field and go back to the folder — Escape, and the ✕ button. */
  clear: () => void
  /** Send the same query again, without waiting for the debounce. */
  retry: () => void
  /**
   * Whether the explorer should be showing results instead of the folder. It
   * is about the *field*, not about the state: a query of one character is
   * searching nothing, but the panel still belongs to the search, and that is
   * where «escribe al menos dos caracteres» has to be said.
   */
  active: boolean
  state: SearchState
}

/**
 * The search as the whole page shares it: the field in the header writes the
 * query, the panel in the explorer reads the state, and both of them are the
 * same hook — see `app/search-provider.tsx`.
 *
 * Two things are deliberately kept apart. The *query* is React state, so the
 * field is a controlled input that responds to every keystroke; the *request*
 * is not sent until the query has sat still for `SEARCH_DEBOUNCE_MS`, so
 * typing a word costs one search rather than one per letter. The only thing
 * that skips the wait is «Reintentar», which is a request the user just asked
 * for by hand.
 *
 * Ordering is not left to the network: every request carries an increasing
 * token and the reducer only writes the answer of the request it is waiting
 * for, so a slow search for `pag` cannot land on top of the results for
 * `pagos`. Nothing is aborted — the answer is simply not the one being shown.
 */
export function useSearch(): SearchApi {
  const [query, setQuery] = useState('')
  const [state, dispatch] = useReducer(searchReducer, IDLE_SEARCH)
  // Bumped by «Reintentar»: without it a retry would change nothing the effect
  // below depends on, and the same failed query would never be sent again.
  const [attempt, setAttempt] = useState(0)
  /** The request that left last. Its answer is the only one worth writing. */
  const token = useRef(0)
  /** Set by «Reintentar», so that one request goes out without the debounce. */
  const immediate = useRef(false)

  useEffect(() => {
    // Below the minimum — which every query passes through as it is typed — the
    // search is simply not run, and whatever was on screen is forgotten rather
    // than left there as the answer to a query nobody can see any more.
    if (!prepareQuery(query).ok) {
      dispatch({ type: 'cleared' })
      return
    }

    const delay = immediate.current ? 0 : SEARCH_DEBOUNCE_MS
    immediate.current = false

    const handle = setTimeout(() => {
      const round = ++token.current
      dispatch({ type: 'started', token: round, query })

      // The raw query travels, not the normalised one: the route prepares it
      // itself, and the message it words for a query it refuses has to be
      // about what the user typed.
      fetchSearch(query).then(
        (response) => dispatch({ type: 'resolved', token: round, response }),
        (err: unknown) => dispatch({ type: 'failed', token: round, message: errorMessage(err) }),
      )
    }, delay)

    // Typing again cancels a request that had not left yet; one that already
    // left is left alone and its answer is dropped by the reducer.
    return () => clearTimeout(handle)
  }, [attempt, query])

  const clear = useCallback(() => setQuery(''), [])
  const retry = useCallback(() => {
    immediate.current = true
    setAttempt((previous) => previous + 1)
  }, [])

  return { query, setQuery, clear, retry, active: query.trim() !== '', state }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'No se pudo completar la búsqueda.'
}
