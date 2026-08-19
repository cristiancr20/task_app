import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchDrafts, saveDrafts } from '@/lib/drafts-client'
import type { DraftRow, DraftsState } from '@/lib/drafts-store'

/** One stored row, with only the fields a test cares about overridden. */
function row(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: 'row-1',
    title: 'Enviar el presupuesto',
    description: 'Antes del viernes',
    priority: 'high',
    mentioned: 'Ana',
    evidence: 'Ana: yo mando el presupuesto',
    include: true,
    ...overrides,
  }
}

function state(overrides: Partial<DraftsState> = {}): DraftsState {
  return { rows: [row()], baseline: [row()], extracted: true, ...overrides }
}

type FetchCall = { url: string; init: RequestInit | undefined }

/** Replace `fetch` with one that answers `responses` in order, recording calls. */
function stubFetch(...responses: Array<Response | Error>): FetchCall[] {
  const calls: FetchCall[] = []
  let index = 0

  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const answer = responses[Math.min(index++, responses.length - 1)]
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
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

describe('fetchDrafts', () => {
  it('asks the route for that note', async () => {
    const calls = stubFetch(json(state()))

    await fetchDrafts('reuniones/lunes.md')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/drafts?path=reuniones%2Flunes.md')
  })

  // The path is a query parameter, so a space or an accent in a file name has
  // to survive the round trip untouched.
  it('encodes the path', async () => {
    const calls = stubFetch(json(state()))

    await fetchDrafts('reuniones/día 1 & 2.md')

    expect(calls[0].url).toBe('/api/drafts?path=reuniones%2Fd%C3%ADa%201%20%26%202.md')
  })

  // Drafts change on every keystroke: a cached read would restore the table to
  // whatever the browser saw first.
  it('never reads from the cache', async () => {
    const calls = stubFetch(json(state()))

    await fetchDrafts('nota.md')

    expect(calls[0].init?.cache).toBe('no-store')
  })

  it('answers the stored state', async () => {
    stubFetch(json(state()))

    await expect(fetchDrafts('nota.md')).resolves.toEqual(state())
  })

  it('answers an empty state for a note that has none', async () => {
    const empty = { rows: [], baseline: [], extracted: false }
    stubFetch(json(empty))

    await expect(fetchDrafts('nota.md')).resolves.toEqual(empty)
  })

  it('reports a server it could not reach', async () => {
    stubFetch(new TypeError('Failed to fetch'))

    await expect(fetchDrafts('nota.md')).rejects.toThrow(
      'No se pudo contactar con el servidor de la aplicación.',
    )
  })

  // The route already words its refusals for the user, so its text travels
  // verbatim rather than being mapped a second time here.
  it('passes the route’s own message through', async () => {
    stubFetch(json({ error: 'No hay carpeta de contexto configurada.' }, 400))

    await expect(fetchDrafts('nota.md')).rejects.toThrow(
      'No hay carpeta de contexto configurada.',
    )
  })

  it('falls back to its own message when the failure carries none', async () => {
    stubFetch(json({}, 500))

    await expect(fetchDrafts('nota.md')).rejects.toThrow(
      'No se pudieron cargar las tareas guardadas.',
    )
  })

  it('falls back when the failure is not even JSON', async () => {
    stubFetch(html(502))

    await expect(fetchDrafts('nota.md')).rejects.toThrow(
      'No se pudieron cargar las tareas guardadas.',
    )
  })

  it.each([
    ['rows missing', { baseline: [], extracted: false }],
    ['rows not a list', { rows: {}, baseline: [], extracted: false }],
    ['baseline missing', { rows: [], extracted: false }],
    ['extracted missing', { rows: [], baseline: [] }],
    ['extracted not a boolean', { rows: [], baseline: [], extracted: 'sí' }],
    ['a list instead of a state', []],
    ['null', null],
  ])('refuses an answer with %s', async (_label, body) => {
    stubFetch(json(body))

    await expect(fetchDrafts('nota.md')).rejects.toThrow(
      'El servidor devolvió una respuesta inesperada.',
    )
  })

  it('refuses an answer that is not JSON', async () => {
    stubFetch(html(200))

    await expect(fetchDrafts('nota.md')).rejects.toThrow(
      'El servidor devolvió una respuesta inesperada.',
    )
  })
})

describe('saveDrafts', () => {
  it('puts the whole table to the route', async () => {
    const calls = stubFetch(json(state()))

    await saveDrafts('reuniones/lunes.md', state())

    expect(calls[0].url).toBe('/api/drafts')
    expect(calls[0].init?.method).toBe('PUT')
  })

  // A `PUT` of the whole state is what lets the queue drop every save but the
  // newest: the body is the table, not a patch to be replayed in order.
  it('sends the path with the state', async () => {
    const calls = stubFetch(json(state()))

    await saveDrafts('reuniones/lunes.md', state())

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      path: 'reuniones/lunes.md',
      ...state(),
    })
  })

  it('sends the baseline too, so the change count survives the reload', async () => {
    const calls = stubFetch(json(state()))
    const edited = { ...row(), title: 'Enviar el presupuesto revisado' }

    await saveDrafts('nota.md', { rows: [edited], baseline: [row()], extracted: true })

    const body = JSON.parse(String(calls[0].init?.body)) as DraftsState
    expect(body.rows).toEqual([edited])
    expect(body.baseline).toEqual([row()])
  })

  it('declares a JSON body', async () => {
    const calls = stubFetch(json(state()))

    await saveDrafts('nota.md', state())

    expect(calls[0].init?.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('answers what the route stored', async () => {
    // The route sieves what it is sent, so the answer is the truth about disk.
    const stored = { rows: [row()], baseline: [], extracted: false }
    stubFetch(json(stored))

    await expect(saveDrafts('nota.md', state())).resolves.toEqual(stored)
  })

  it('reports a server it could not reach', async () => {
    stubFetch(new TypeError('Failed to fetch'))

    await expect(saveDrafts('nota.md', state())).rejects.toThrow(
      'No se pudo contactar con el servidor de la aplicación.',
    )
  })

  it('passes the route’s own message through', async () => {
    stubFetch(json({ error: 'Solo se pueden leer archivos .md: nota.txt' }, 400))

    await expect(saveDrafts('nota.txt', state())).rejects.toThrow(
      'Solo se pueden leer archivos .md: nota.txt',
    )
  })

  it('falls back to its own message when the failure carries none', async () => {
    stubFetch(json({}, 500))

    await expect(saveDrafts('nota.md', state())).rejects.toThrow(
      'No se pudieron guardar las tareas.',
    )
  })

  it('refuses an answer that is not a stored state', async () => {
    stubFetch(json({ ok: true }))

    await expect(saveDrafts('nota.md', state())).rejects.toThrow(
      'El servidor devolvió una respuesta inesperada.',
    )
  })
})
