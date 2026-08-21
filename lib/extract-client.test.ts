import { afterEach, describe, expect, it, vi } from 'vitest'

import { ExtractionAborted, runExtraction } from '@/lib/extract-client'

/** The shape `POST /api/extract` answers with, minus whatever a test overrides. */
function answer(overrides: Record<string, unknown> = {}): Response {
  return Response.json({ tasks: [], decisions: [], risks: [], openQuestions: [], ...overrides })
}

/** Replace `fetch` with one that answers `response`, recording the init it got. */
function stubFetch(response: Response | Error): { init?: RequestInit } {
  const call: { init?: RequestInit } = {}

  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    call.init = init
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  })

  return call
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runExtraction', () => {
  it('passes the signal down to the request', async () => {
    const controller = new AbortController()
    const call = stubFetch(answer())

    await runExtraction('nota.md', controller.signal)

    expect(call.init?.signal).toBe(controller.signal)
  })

  it('reports a cancelled run as ExtractionAborted, not as a failure', async () => {
    const controller = new AbortController()
    controller.abort()
    // What an aborted `fetch` actually throws; the signal is what tells the
    // cancellation apart from the server not being there.
    stubFetch(new DOMException('The operation was aborted.', 'AbortError'))

    await expect(runExtraction('nota.md', controller.signal)).rejects.toBeInstanceOf(
      ExtractionAborted,
    )
  })

  it('still reports an unreachable server as a plain failure', async () => {
    const controller = new AbortController()
    stubFetch(new TypeError('Failed to fetch'))

    const failure = runExtraction('nota.md', controller.signal)

    await expect(failure).rejects.not.toBeInstanceOf(ExtractionAborted)
    await expect(failure).rejects.toThrow('No se pudo contactar con el servidor de la aplicación.')
  })

  it('works without a signal at all', async () => {
    const call = stubFetch(answer({ tasks: [] }))

    await expect(runExtraction('nota.md')).resolves.toMatchObject({ tasks: [] })
    expect(call.init?.signal).toBeUndefined()
  })
})
