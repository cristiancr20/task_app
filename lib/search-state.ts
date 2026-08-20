/**
 * The browser's side of the search: what state a query is in, and how an
 * excerpt is cut into the three pieces the panel renders.
 *
 * It is a reducer rather than a handful of `useState` calls because the one
 * rule that matters here is not about React: an answer belongs to the request
 * that asked for it, and a request the user has already moved past must not be
 * allowed to write anything. Every action carries the `token` of its request
 * and the state carries the token it is showing, so «a late answer never
 * overwrites a newer query» is a comparison in a pure function — testable
 * without a fake network, a fake clock or a rendered component.
 */

import type { SearchMatch, SearchResult } from './search'
import type { SearchResponse } from './search-client'

/**
 * How long the field has to sit still before the query is sent.
 *
 * A search reads note bodies from disk, so one request per keystroke is both
 * wasted work and a list that rewrites itself under the user's eyes. A quarter
 * of a second is under the ~300 ms where a pause starts being noticed, so the
 * results still feel like they follow the typing.
 */
export const SEARCH_DEBOUNCE_MS = 250

/**
 * Where the search stands.
 *
 * `idle` is «nothing is being searched»: an empty field, or one with less than
 * `MIN_QUERY_LENGTH` in it — which is a state the field passes through on the
 * way to every query, not a failure. The other three each say something the
 * panel words differently, and `ready` carries `truncated` so «no hay más» and
 * «hay más, pero no caben» are never shown as the same list.
 */
export type SearchState =
  | { status: 'idle' }
  | { status: 'searching'; token: number; query: string }
  | {
      status: 'ready'
      token: number
      query: string
      results: SearchResult[]
      /** A limit stopped the search short — the list is not everything there is. */
      truncated: boolean
    }
  | { status: 'error'; token: number; query: string; message: string }

/** What can happen to a search, always naming the request it is about. */
export type SearchAction =
  /** The field emptied, or fell below the minimum: forget the query entirely. */
  | { type: 'cleared' }
  /** A request just left, after the debounce. */
  | { type: 'started'; token: number; query: string }
  | { type: 'resolved'; token: number; response: SearchResponse }
  | { type: 'failed'; token: number; message: string }

/** Nothing is being searched — the panel shows the folder instead. */
export const IDLE_SEARCH: SearchState = { status: 'idle' }

/**
 * The state a query is in after one thing happens to it.
 *
 * An answer is only written when it is the answer of the request the state is
 * currently showing: anything older is returned unchanged (the same object, so
 * React does not even re-render), and so is anything at all once the field has
 * been cleared. That covers both races a search has — the slow response of an
 * abandoned query, and the response of a query cancelled outright.
 */
export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case 'cleared':
      return state.status === 'idle' ? state : IDLE_SEARCH

    case 'started':
      // A new request always wins: it is the newest thing the user asked for.
      return { status: 'searching', token: action.token, query: action.query }

    case 'resolved': {
      if (!isCurrent(state, action.token)) return state
      return {
        status: 'ready',
        token: state.token,
        query: state.query,
        results: action.response.results,
        truncated: action.response.truncated,
      }
    }

    case 'failed': {
      if (!isCurrent(state, action.token)) return state
      return { status: 'error', token: state.token, query: state.query, message: action.message }
    }
  }
}

/**
 * Whether an answer is about the request on screen.
 *
 * `idle` has no token on purpose: the field was cleared, so there is nothing
 * any answer could still be about.
 */
function isCurrent(
  state: SearchState,
  token: number,
): state is Exclude<SearchState, { status: 'idle' }> {
  return state.status !== 'idle' && state.token === token
}

/** An excerpt cut in three, so the middle piece can be marked as the hit. */
export type HighlightParts = {
  before: string
  /** The characters the query matched — what the panel highlights. */
  hit: string
  after: string
}

/**
 * Cut one excerpt around its match.
 *
 * The offsets come from the server, so they are checked rather than trusted:
 * they are clamped into the excerpt and ordered before anything is sliced. A
 * pair that made no sense would otherwise highlight a stretch of nothing, or
 * — with a negative start — silently count from the end of the text.
 *
 * The three pieces are plain strings; the highlight is a `<mark>` the panel
 * puts around the middle one. Nothing here builds markup, so a note that
 * contains HTML is shown as the characters it contains.
 */
export function highlightParts(match: SearchMatch): HighlightParts {
  const { text } = match
  const start = clamp(match.start, 0, text.length)
  const end = clamp(match.end, start, text.length)

  return {
    before: text.slice(0, start),
    hit: text.slice(start, end),
    after: text.slice(end),
  }
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  return Math.min(Math.max(value, low), high)
}

/**
 * The excerpt a result is shown with, or null for the — impossible, but not
 * unrepresentable — result that carries none.
 *
 * One row shows one excerpt: the count next to it says how many times the note
 * says the phrase, and five excerpts per note would push the other notes off
 * the panel. `searchNote` puts the title's matches first, so a note whose
 * *title* is the phrase shows that rather than the fifth line of its body.
 */
export function leadMatch(result: SearchResult): SearchMatch | null {
  return result.matches[0] ?? null
}
