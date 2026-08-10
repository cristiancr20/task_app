import type { HistoryEntry } from './store'
import type { Transcript } from './transcripts'

/** What `GET /api/transcript` answers: the note plus its push history. */
export type TranscriptView = Transcript & { history: HistoryEntry[] }

/**
 * `GET /api/transcript` as seen from the browser.
 *
 * Like `fetchFolder`, the route's own Spanish message travels as the `Error`'s
 * message so the UI can render it without a second mapping, and the types come
 * from the node-only modules as *type-only* imports — erased at compile time,
 * so neither the scanner nor the store reaches the client bundle.
 */
export async function fetchTranscript(relPath: string): Promise<TranscriptView> {
  let response: Response
  try {
    response = await fetch(`/api/transcript?path=${encodeURIComponent(relPath)}`, {
      cache: 'no-store',
    })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) throw new Error(errorMessage(body))
  if (!isTranscript(body)) throw new Error('El servidor devolvió una respuesta inesperada.')

  return body
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudo leer el archivo.'
}

function isTranscript(body: unknown): body is TranscriptView {
  if (typeof body !== 'object' || body === null) return false
  const { meta, body: text, history } = body as Record<string, unknown>
  return typeof meta === 'object' && meta !== null && typeof text === 'string' && Array.isArray(history)
}
