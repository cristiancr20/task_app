import type { HistoryEntry, HistoryIssue } from './store'

/**
 * `POST /api/history` as seen from the browser: what a folder of notes has
 * already pushed to Linear, keyed by note path.
 *
 * The note on screen carries its own history inside `GET /api/transcript`; this
 * is the same record for the notes *around* it, which is what the
 * pending-commitments panel selects over — it needs the project each push went
 * to, the issues it created and when, and none of that is in a folder listing.
 *
 * Same contract as every other wrapper here: only the paths travel, the route
 * words its own refusals and they reach the UI verbatim, and `lib/store.ts`
 * crosses as a *type-only* import so the module that reads the config file and
 * the API keys never lands in the bundle.
 *
 * A note that was never pushed answers `[]`, not an error — that is the normal
 * case for most rows of most folders.
 */
export async function fetchFolderHistory(
  relPaths: readonly string[],
): Promise<Record<string, HistoryEntry[]>> {
  let response: Response
  try {
    response = await fetch('/api/history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: relPaths }),
      cache: 'no-store',
    })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) throw new Error(errorMessage(body))
  if (!isFolderHistory(body)) throw new Error('El servidor devolvió una respuesta inesperada.')

  return body.history
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudo leer el historial de envíos.'
}

/** One list of pushes per note path, each of them checked entry by entry. */
function isFolderHistory(body: unknown): body is { history: Record<string, HistoryEntry[]> } {
  if (typeof body !== 'object' || body === null) return false
  const { history } = body as { history?: unknown }
  if (typeof history !== 'object' || history === null || Array.isArray(history)) return false
  return Object.values(history).every(
    (entries) => Array.isArray(entries) && entries.every(isHistoryEntry),
  )
}

/**
 * One push. The destination is checked as «string or null» rather than merely
 * present: `projectId` is what the panel filters by, and a value of any other
 * shape would silently match nothing — or, worse, match another project's null.
 */
function isHistoryEntry(entry: unknown): entry is HistoryEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const { pushedAt, issues, teamId, projectId } = entry as Record<string, unknown>
  return (
    typeof pushedAt === 'string' &&
    Array.isArray(issues) &&
    issues.every(isHistoryIssue) &&
    isNullableString(teamId) &&
    isNullableString(projectId)
  )
}

/** One created issue, as the store keeps it — `mentioned` may be «no consta». */
function isHistoryIssue(issue: unknown): issue is HistoryIssue {
  if (typeof issue !== 'object' || issue === null) return false
  const { id, identifier, url, title, mentioned } = issue as Record<string, unknown>
  return (
    typeof id === 'string' &&
    typeof identifier === 'string' &&
    typeof url === 'string' &&
    typeof title === 'string' &&
    isNullableString(mentioned)
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}
