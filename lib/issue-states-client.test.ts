import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchIssueStates } from '@/lib/issue-states-client'
import type { IssueState } from '@/lib/linear'

/** One reported state, with only the fields a test cares about overridden. */
function state(overrides: Partial<IssueState> = {}): IssueState {
  return {
    id: 'iss_1',
    identifier: 'ENG-1',
    title: 'Escribir el informe',
    url: 'https://linear.app/x/issue/ENG-1',
    stateName: 'In Progress',
    stateType: 'started',
    ...overrides,
  }
}

type FetchCall = { url: string; init: RequestInit | undefined }

/** Replace `fetch` with one that answers `response`, recording the calls. */
function stubFetch(response: Response | Error): FetchCall[] {
  const calls: FetchCall[] = []

  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  })

  return calls
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A body that is not JSON at all — a proxy's error page, say. */
function html(status: number): Response {
  return new Response('<html>502</html>', { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchIssueStates', () => {
  it('answers the states the route reported', async () => {
    stubFetch(json({ states: [state(), state({ id: 'iss_2', stateType: 'completed' })] }))

    await expect(fetchIssueStates('reuniones/lunes.md')).resolves.toEqual([
      state(),
      state({ id: 'iss_2', stateType: 'completed' }),
    ])
  })

  // The ids live in the push history and the key in the config, both server
  // state: the path is the whole request.
  it('posts only the path of the note', async () => {
    const calls = stubFetch(json({ states: [] }))

    await fetchIssueStates('reuniones/lunes.md')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/linear/issue-states')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ path: 'reuniones/lunes.md' })
  })

  // Whether an issue is done changes in Linear, not here: a cached answer would
  // pin the report to whatever the browser saw first.
  it('never reads from the cache', async () => {
    const calls = stubFetch(json({ states: [] }))

    await fetchIssueStates('nota.md')

    expect(calls[0].init?.cache).toBe('no-store')
  })

  it('answers an empty report for a note that never went to Linear', async () => {
    stubFetch(json({ states: [] }))

    await expect(fetchIssueStates('nota.md')).resolves.toEqual([])
  })

  // The route already words its refusals for the user, so its text travels
  // verbatim rather than being mapped a second time here.
  it('rethrows the message the route wrote', async () => {
    const refusal = 'No hay ninguna API key de Linear guardada. Guárdala en /settings.'
    stubFetch(json({ error: refusal }, 400))

    await expect(fetchIssueStates('nota.md')).rejects.toThrow(refusal)
  })

  it('falls back to its own message when the failure carries no text', async () => {
    stubFetch(json({}, 500))

    await expect(fetchIssueStates('nota.md')).rejects.toThrow(
      'No se pudo consultar el estado de los issues en Linear.',
    )
  })

  it('falls back when the failure is not even JSON', async () => {
    stubFetch(html(502))

    await expect(fetchIssueStates('nota.md')).rejects.toThrow(
      'No se pudo consultar el estado de los issues en Linear.',
    )
  })

  it.each([
    ['states missing', { issues: [] }],
    ['states not a list', { states: {} }],
    ['a list instead of a report', []],
    ['null', null],
    ['an incomplete state', { states: [{ id: 'iss_1' }] }],
    ['a state without url', { states: [{ ...state(), url: undefined }] }],
    [
      'a state whose stateType is not in the union',
      { states: [{ ...state(), stateType: 'done' }] },
    ],
    ['a state whose stateType is missing', { states: [{ ...state(), stateType: undefined }] }],
  ])('refuses an answer with %s', async (_label, body) => {
    stubFetch(json(body))

    await expect(fetchIssueStates('nota.md')).rejects.toThrow(
      'El servidor devolvió una respuesta inesperada.',
    )
  })

  it('refuses an answer that is not JSON', async () => {
    stubFetch(html(200))

    await expect(fetchIssueStates('nota.md')).rejects.toThrow(
      'El servidor devolvió una respuesta inesperada.',
    )
  })

  it('reports a server it could not reach', async () => {
    stubFetch(new TypeError('Failed to fetch'))

    await expect(fetchIssueStates('nota.md')).rejects.toThrow(
      'No se pudo contactar con el servidor de la aplicación.',
    )
  })
})
