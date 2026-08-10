import { isPushEvent, type PushEvent, type PushRequest } from './push-events'

/**
 * `POST /api/linear/push` as seen from the browser: it calls `onEvent` for each
 * line the route streams and resolves when the run ends.
 *
 * Same failure contract as `fetchFolder`, `fetchTranscript` and `extractTasks`:
 * the route already answers user-facing Spanish, so a rejection carries that
 * text verbatim. The difference is *when* it can reject — only while the
 * request is being refused. Once the stream is open the status is already 200
 * and every failure of an individual issue arrives as a `failed` event, which
 * is what lets the run keep going.
 */
export async function pushTasks(
  plan: PushRequest,
  onEvent: (event: PushEvent) => void,
): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/linear/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(plan),
      cache: 'no-store',
    })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new Error(errorMessage(body))
  }

  if (!response.body) {
    throw new Error('El servidor devolvió una respuesta inesperada.')
  }

  await readEvents(response.body, onEvent)
}

/**
 * The NDJSON body, line by line. A chunk is not a line: a `created` event can
 * arrive split in two, and two events can arrive in one chunk, so the tail
 * after the last newline is carried over to the next read.
 */
async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: PushEvent) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        emit(buffer.slice(0, newline), onEvent)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
  } catch {
    // The connection dropped mid-run. Whatever was already reported stands —
    // the caller decides what to say about the issue that was in flight.
    throw new Error('Se perdió la conexión con el servidor durante el envío.')
  } finally {
    reader.releaseLock()
  }

  // A run that ended cleanly finishes with a newline, so anything left here is
  // a truncated line; it is dropped rather than half-parsed.
  emit(buffer, onEvent)
}

function emit(line: string, onEvent: (event: PushEvent) => void): void {
  const trimmed = line.trim()
  if (!trimmed) return

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return
  }

  if (isPushEvent(parsed)) onEvent(parsed)
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudieron crear las tareas en Linear.'
}
