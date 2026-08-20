import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchFolderHistory } from '@/lib/history-client'
import type { HistoryEntry, HistoryIssue } from '@/lib/store'

/** One created issue, with only the fields a test cares about overridden. */
function issue(overrides: Partial<HistoryIssue> = {}): HistoryIssue {
  return {
    id: 'iss_1',
    identifier: 'ENG-1',
    url: 'https://linear.app/acme/issue/ENG-1',
    title: 'Escribir el informe',
    mentioned: null,
    ...overrides,
  }
}

/** One push, defaulting to the shape a push records today. */
function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    pushedAt: '2026-08-01T10:00:00.000Z',
    issues: [issue()],
    teamId: 'team-1',
    projectId: 'project-acme',
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

describe('fetchFolderHistory', () => {
  it('answers the pushes of every note the folder asked about', async () => {
    stubFetch(
      json({
        history: {
          'reuniones/lunes.md': [entry()],
          'reuniones/martes.md': [entry({ pushedAt: '2026-08-02T10:00:00.000Z' })],
        },
      }),
    )

    await expect(
      fetchFolderHistory(['reuniones/lunes.md', 'reuniones/martes.md']),
    ).resolves.toEqual({
      'reuniones/lunes.md': [entry()],
      'reuniones/martes.md': [entry({ pushedAt: '2026-08-02T10:00:00.000Z' })],
    })
  })

  // The panel is about the folder on screen, so it asks about it once — the
  // same bargain `/api/linear/folder-issue-states` makes for the badges.
  it('posts every path in a single request', async () => {
    const calls = stubFetch(json({ history: {} }))

    await fetchFolderHistory(['a.md', 'b.md', 'c.md'])

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/history')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ paths: ['a.md', 'b.md', 'c.md'] })
  })

  it('never reads from the cache', async () => {
    const calls = stubFetch(json({ history: {} }))

    await fetchFolderHistory(['a.md'])

    expect(calls[0].init?.cache).toBe('no-store')
  })

  it('accepts a folder where nothing was ever pushed', async () => {
    stubFetch(json({ history: {} }))

    await expect(fetchFolderHistory(['a.md'])).resolves.toEqual({})
  })

  it('accepts a note listed with no pushes', async () => {
    stubFetch(json({ history: { 'a.md': [] } }))

    await expect(fetchFolderHistory(['a.md'])).resolves.toEqual({ 'a.md': [] })
  })

  // An entry written before the destination — or before the name — was
  // recorded reads as «no consta», which is a value and not a broken answer.
  it('accepts an entry that names neither destination nor person', async () => {
    const old = entry({ teamId: null, projectId: null, issues: [issue({ mentioned: null })] })
    stubFetch(json({ history: { 'a.md': [old] } }))

    await expect(fetchFolderHistory(['a.md'])).resolves.toEqual({ 'a.md': [old] })
  })

  it('accepts an issue that names who was put in charge', async () => {
    const named = entry({ issues: [issue({ mentioned: 'Ana' })] })
    stubFetch(json({ history: { 'a.md': [named] } }))

    await expect(fetchFolderHistory(['a.md'])).resolves.toEqual({ 'a.md': [named] })
  })

  it('passes the route’s own message through', async () => {
    stubFetch(json({ error: 'No hay carpeta de contexto configurada.' }, 400))

    await expect(fetchFolderHistory(['a.md'])).rejects.toThrow(
      'No hay carpeta de contexto configurada.',
    )
  })

  it('falls back when the failure carries no message', async () => {
    stubFetch(json({}, 500))

    await expect(fetchFolderHistory(['a.md'])).rejects.toThrow(
      'No se pudo leer el historial de envíos.',
    )
  })

  it('falls back when the failure is not even JSON', async () => {
    stubFetch(html(502))

    await expect(fetchFolderHistory(['a.md'])).rejects.toThrow(
      'No se pudo leer el historial de envíos.',
    )
  })

  it.each([
    ['history missing', { pushes: {} }],
    ['history as a list', { history: [] }],
    ['history as null', { history: null }],
    ['a list instead of a report', []],
    ['null', null],
    ['a note whose pushes are not a list', { history: { 'a.md': entry() } }],
    ['an entry with no timestamp', { history: { 'a.md': [{ issues: [] }] } }],
    ['an entry with no issues', { history: { 'a.md': [{ pushedAt: '2026-08-01' }] } }],
    [
      'an entry whose project is not a string',
      { history: { 'a.md': [{ ...entry(), projectId: 7 }] } },
    ],
    ['an incomplete issue', { history: { 'a.md': [{ ...entry(), issues: [{ id: 'iss_1' }] }] } }],
    [
      'an issue whose person is not a string',
      { history: { 'a.md': [{ ...entry(), issues: [{ ...issue(), mentioned: 7 }] }] } },
    ],
  ])('refuses an answer with %s', async (_label, body) => {
    stubFetch(json(body))

    await expect(fetchFolderHistory(['a.md'])).rejects.toThrow(
      'El servidor devolvió una respuesta inesperada.',
    )
  })

  it('refuses an answer that is not JSON', async () => {
    stubFetch(html(200))

    await expect(fetchFolderHistory(['a.md'])).rejects.toThrow(
      'El servidor devolvió una respuesta inesperada.',
    )
  })

  it('reports a server it could not reach', async () => {
    stubFetch(new TypeError('Failed to fetch'))

    await expect(fetchFolderHistory(['a.md'])).rejects.toThrow(
      'No se pudo contactar con el servidor de la aplicación.',
    )
  })
})
