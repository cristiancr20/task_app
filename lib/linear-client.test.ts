import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchLinearIssues } from '@/lib/linear-client'
import type { ExistingIssue } from '@/lib/linear'

/** One issue as the route sends it, with only the fields a test cares about overridden. */
function issue(overrides: Partial<ExistingIssue> = {}): ExistingIssue {
  return {
    id: 'iss_1',
    identifier: 'ENG-1',
    title: 'Escribir el informe',
    url: 'https://linear.app/x/issue/ENG-1',
    stateName: 'Todo',
    closed: false,
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchLinearIssues', () => {
  it('asks the route for the project scope and returns the issues', async () => {
    const calls = stubFetch(json({ issues: [issue()] }))

    await expect(fetchLinearIssues({ teamId: 't1', projectId: 'p1' })).resolves.toEqual([issue()])
    expect(calls[0].url).toBe('/api/linear/issues?teamId=t1&projectId=p1')
  })

  // An empty `projectId=` in the URL would reach the route as a project whose id
  // is `''`, not as «no project».
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['blank', '   '],
  ])('leaves projectId out of the URL when it is %s', async (_label, projectId) => {
    const calls = stubFetch(json({ issues: [] }))

    await fetchLinearIssues({ teamId: 't1', projectId })

    expect(calls[0].url).toBe('/api/linear/issues?teamId=t1')
  })

  it('rethrows the message the route wrote', async () => {
    stubFetch(json({ error: 'Linear: Authentication required' }, 401))

    await expect(fetchLinearIssues({ teamId: 't1' })).rejects.toThrow(
      'Linear: Authentication required',
    )
  })

  it('falls back to its own message when the failure carries no text', async () => {
    stubFetch(new Response('<html>502</html>', { status: 502 }))

    await expect(fetchLinearIssues({ teamId: 't1' })).rejects.toThrow(
      'No se pudieron cargar los issues de Linear.',
    )
  })

  it('rejects a body that is not a list of issues', async () => {
    stubFetch(json({ issues: [{ id: 'iss_1' }] }))

    await expect(fetchLinearIssues({ teamId: 't1' })).rejects.toThrow(
      'El servidor devolvió una respuesta inesperada.',
    )
  })

  it('reports a network failure as one', async () => {
    stubFetch(new TypeError('fetch failed'))

    await expect(fetchLinearIssues({ teamId: 't1' })).rejects.toThrow(
      'No se pudo contactar con el servidor de la aplicación.',
    )
  })
})
