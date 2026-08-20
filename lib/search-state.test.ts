import { describe, expect, it } from 'vitest'

import type { SearchMatch, SearchResult } from '@/lib/search'
import type { SearchResponse } from '@/lib/search-client'
import {
  highlightParts,
  IDLE_SEARCH,
  leadMatch,
  searchReducer,
  type SearchState,
} from '@/lib/search-state'

function match(partial: Partial<SearchMatch> = {}): SearchMatch {
  return { field: 'body', text: 'hablamos del endpoint de pagos', start: 15, end: 23, ...partial }
}

function result(partial: Partial<SearchResult> = {}): SearchResult {
  return {
    relPath: '2026/agosto/reunion.md',
    fileName: 'reunion.md',
    title: 'Reunión de agosto',
    date: '2026-08-12',
    matchCount: 1,
    matches: [match()],
    ...partial,
  }
}

function response(partial: Partial<SearchResponse> = {}): SearchResponse {
  return { results: [result()], truncated: false, ...partial }
}

/** The state after one request left and came back, as most tests need it. */
function ready(token = 1): SearchState {
  const started = searchReducer(IDLE_SEARCH, { type: 'started', token, query: 'pagos' })
  return searchReducer(started, { type: 'resolved', token, response: response() })
}

describe('searchReducer', () => {
  it('starts idle and stays idle when cleared again', () => {
    expect(searchReducer(IDLE_SEARCH, { type: 'cleared' })).toBe(IDLE_SEARCH)
  })

  it('is searching while a request is in flight', () => {
    expect(searchReducer(IDLE_SEARCH, { type: 'started', token: 1, query: 'pagos' })).toEqual({
      status: 'searching',
      token: 1,
      query: 'pagos',
    })
  })

  it('shows the results of the request it is waiting for', () => {
    expect(ready()).toEqual({
      status: 'ready',
      token: 1,
      query: 'pagos',
      results: [result()],
      truncated: false,
    })
  })

  it('carries whether the answer was cut short', () => {
    const started = searchReducer(IDLE_SEARCH, { type: 'started', token: 7, query: 'pagos' })
    const state = searchReducer(started, {
      type: 'resolved',
      token: 7,
      response: response({ truncated: true }),
    })

    expect(state).toMatchObject({ status: 'ready', truncated: true })
  })

  it('shows the failure of the request it is waiting for', () => {
    const started = searchReducer(IDLE_SEARCH, { type: 'started', token: 1, query: 'pagos' })

    expect(searchReducer(started, { type: 'failed', token: 1, message: 'No se pudo buscar.' })).toEqual(
      { status: 'error', token: 1, query: 'pagos', message: 'No se pudo buscar.' },
    )
  })

  it('keeps the query a retry is about, so it can be sent again', () => {
    const started = searchReducer(IDLE_SEARCH, { type: 'started', token: 1, query: 'pagos' })
    const failed = searchReducer(started, { type: 'failed', token: 1, message: 'Sin conexión.' })

    expect(failed).toMatchObject({ query: 'pagos' })
  })

  // The whole point of the token: two requests can be in flight, and only the
  // newer one may write anything.
  it('ignores the answer of a request a newer query has replaced', () => {
    const first = searchReducer(IDLE_SEARCH, { type: 'started', token: 1, query: 'pag' })
    const second = searchReducer(first, { type: 'started', token: 2, query: 'pagos' })
    const late = searchReducer(second, {
      type: 'resolved',
      token: 1,
      response: response({ results: [result({ title: 'Vieja' })] }),
    })

    expect(late).toBe(second)
  })

  it('ignores the failure of a request a newer query has replaced', () => {
    const first = searchReducer(IDLE_SEARCH, { type: 'started', token: 1, query: 'pag' })
    const second = searchReducer(first, { type: 'started', token: 2, query: 'pagos' })

    expect(searchReducer(second, { type: 'failed', token: 1, message: 'Vieja' })).toBe(second)
  })

  it('does not let a late answer overwrite the results already on screen', () => {
    const shown = ready(2)
    const late = searchReducer(shown, {
      type: 'resolved',
      token: 1,
      response: response({ results: [] }),
    })

    expect(late).toBe(shown)
  })

  it('drops any answer that arrives after the field was cleared', () => {
    const started = searchReducer(IDLE_SEARCH, { type: 'started', token: 1, query: 'pagos' })
    const cleared = searchReducer(started, { type: 'cleared' })

    expect(cleared).toEqual({ status: 'idle' })
    expect(searchReducer(cleared, { type: 'resolved', token: 1, response: response() })).toBe(cleared)
    expect(searchReducer(cleared, { type: 'failed', token: 1, message: 'tarde' })).toBe(cleared)
  })

  it('forgets the results when the field is emptied', () => {
    expect(searchReducer(ready(), { type: 'cleared' })).toEqual({ status: 'idle' })
  })

  it('lets a new request replace results already on screen', () => {
    const state = searchReducer(ready(), { type: 'started', token: 2, query: 'facturas' })

    expect(state).toEqual({ status: 'searching', token: 2, query: 'facturas' })
  })
})

describe('highlightParts', () => {
  it('cuts the excerpt around the match', () => {
    expect(highlightParts(match({ text: 'ana dijo pagos hoy', start: 9, end: 14 }))).toEqual({
      before: 'ana dijo ',
      hit: 'pagos',
      after: ' hoy',
    })
  })

  it('highlights a match at the very start', () => {
    expect(highlightParts(match({ text: 'pagos hoy', start: 0, end: 5 }))).toEqual({
      before: '',
      hit: 'pagos',
      after: ' hoy',
    })
  })

  it('highlights a match at the very end', () => {
    expect(highlightParts(match({ text: 'hoy pagos', start: 4, end: 9 }))).toEqual({
      before: 'hoy ',
      hit: 'pagos',
      after: '',
    })
  })

  it('keeps the accented characters the fold stripped inside the highlight', () => {
    expect(highlightParts(match({ text: 'la reunión fue', start: 3, end: 10 }))).toMatchObject({
      hit: 'reunión',
    })
  })

  // The offsets come over the network, so a pair that makes no sense must cut
  // nothing rather than count from the end of the string.
  it('clamps a start below zero', () => {
    expect(highlightParts(match({ text: 'pagos', start: -3, end: 5 }))).toEqual({
      before: '',
      hit: 'pagos',
      after: '',
    })
  })

  it('clamps an end past the text', () => {
    expect(highlightParts(match({ text: 'pagos', start: 2, end: 99 }))).toEqual({
      before: 'pa',
      hit: 'gos',
      after: '',
    })
  })

  it('clamps a start past the text into an empty highlight', () => {
    expect(highlightParts(match({ text: 'pagos', start: 12, end: 14 }))).toEqual({
      before: 'pagos',
      hit: '',
      after: '',
    })
  })

  it('never lets the end come before the start', () => {
    expect(highlightParts(match({ text: 'pagos', start: 3, end: 1 }))).toEqual({
      before: 'pag',
      hit: '',
      after: 'os',
    })
  })

  it('treats an offset that is not a number as the lowest one allowed', () => {
    expect(highlightParts(match({ text: 'pagos', start: Number.NaN, end: Number.NaN }))).toEqual({
      before: '',
      hit: '',
      after: 'pagos',
    })
  })
})

describe('leadMatch', () => {
  it('is the first excerpt of the result', () => {
    const first = match({ text: 'uno' })
    expect(leadMatch(result({ matches: [first, match({ text: 'dos' })] }))).toBe(first)
  })

  it('is null for a result with no excerpt at all', () => {
    expect(leadMatch(result({ matches: [] }))).toBeNull()
  })
})
