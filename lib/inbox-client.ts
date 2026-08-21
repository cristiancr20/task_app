import type { InboxItem } from './inbox'

/** What `GET /api/inbox` answers. */
export type InboxResponse = {
  /** Ordered as the view shows them: most recent first, undated last. */
  items: InboxItem[]
  /** True when the walk hit a limit, so this is not everything on disk. */
  truncated: boolean
  /** Notes the walk saw, pending or not. */
  scanned: number
}

/**
 * `GET /api/inbox` as seen from the browser.
 *
 * Same contract as every other wrapper here: the route words its own refusals
 * — «no hay carpeta de contexto» — and they travel as the `Error`'s message so
 * the UI can render `err.message` without a second mapping.
 *
 * `refresh` is the reload button: it asks the server to walk the disk again
 * rather than answer from its index.
 */
export async function fetchInbox({ refresh = false } = {}): Promise<InboxResponse> {
  let response: Response
  try {
    response = await fetch(`/api/inbox${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) throw new Error(errorMessage(body))
  if (!isInboxResponse(body)) throw new Error('El servidor devolvió una respuesta inesperada.')

  return body
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudo leer la bandeja de entrada.'
}

function isInboxResponse(body: unknown): body is InboxResponse {
  if (typeof body !== 'object' || body === null) return false
  const { items, truncated, scanned } = body as Record<string, unknown>
  return (
    typeof truncated === 'boolean' &&
    typeof scanned === 'number' &&
    Array.isArray(items) &&
    items.every(isItem)
  )
}

/**
 * One pending note. `date` is checked as «string or null» rather than merely
 * present, like the search guard: the rows are ordered by it and grouped by it,
 * and a value of another shape would sort somewhere nobody can predict. The
 * status is checked against the two it can be, because the row draws a
 * different badge for each and an unknown third would draw neither.
 */
function isItem(item: unknown): item is InboxItem {
  if (typeof item !== 'object' || item === null) return false
  const { relPath, fileName, title, date, folder, words, approxTokens, status } = item as Record<
    string,
    unknown
  >
  return (
    typeof relPath === 'string' &&
    typeof fileName === 'string' &&
    typeof title === 'string' &&
    (date === null || typeof date === 'string') &&
    typeof folder === 'string' &&
    typeof words === 'number' &&
    typeof approxTokens === 'number' &&
    (status === 'untouched' || status === 'extracted')
  )
}
