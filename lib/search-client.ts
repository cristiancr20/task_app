import type { SearchMatch, SearchResult } from './search'

/** What `GET /api/search` answers. */
export type SearchResponse = {
  /** Ordered as the UI shows them: most matches first, then most recent. */
  results: SearchResult[]
  /** True when a limit stopped the search before it had seen everything. */
  truncated: boolean
}

/**
 * `GET /api/search` as seen from the browser.
 *
 * Same contract as every other wrapper here: the route words its own refusals
 * — «no hay carpeta de contexto», «escribe al menos 2 caracteres» — and they
 * travel as the `Error`'s message so the UI can render `err.message` without a
 * second mapping.
 *
 * `lib/search.ts` is pure, but it is still imported *type-only*: nothing in the
 * bundle needs the search itself, which runs on the server over the notes.
 */
export async function fetchSearch(query: string): Promise<SearchResponse> {
  let response: Response
  try {
    response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      cache: 'no-store',
    })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) throw new Error(errorMessage(body))
  if (!isSearchResponse(body)) throw new Error('El servidor devolvió una respuesta inesperada.')

  return body
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudo completar la búsqueda.'
}

function isSearchResponse(body: unknown): body is SearchResponse {
  if (typeof body !== 'object' || body === null) return false
  const { results, truncated } = body as { results?: unknown; truncated?: unknown }
  return typeof truncated === 'boolean' && Array.isArray(results) && results.every(isResult)
}

/**
 * One note that matched. `date` is checked as «string or null» rather than
 * merely present, the same way the history guard checks `projectId`: the
 * results are sorted and grouped by date, and a value of any other shape would
 * sort in a place nobody can predict.
 */
function isResult(result: unknown): result is SearchResult {
  if (typeof result !== 'object' || result === null) return false
  const { relPath, fileName, title, date, matchCount, matches } = result as Record<string, unknown>
  return (
    typeof relPath === 'string' &&
    typeof fileName === 'string' &&
    typeof title === 'string' &&
    (date === null || typeof date === 'string') &&
    typeof matchCount === 'number' &&
    Array.isArray(matches) &&
    matches.every(isMatch)
  )
}

/**
 * One excerpt. The offsets are checked because the UI slices `text` with them:
 * a pair that is not a pair of numbers would render the highlight over the
 * wrong characters rather than fail.
 */
function isMatch(match: unknown): match is SearchMatch {
  if (typeof match !== 'object' || match === null) return false
  const { field, text, start, end } = match as Record<string, unknown>
  return (
    (field === 'title' || field === 'body') &&
    typeof text === 'string' &&
    typeof start === 'number' &&
    typeof end === 'number'
  )
}
