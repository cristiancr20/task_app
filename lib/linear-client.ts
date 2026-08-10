import type { LinearTeam } from './linear'

/**
 * `GET /api/linear/projects` as seen from the browser: every team the stored
 * key can see, each with its projects, for the push panel's destination picker.
 *
 * Like `fetchFolder` and `fetchTranscript`, the route already answers Spanish
 * messages for everything it knows about (no key stored, Linear unreachable,
 * Linear refusing the key), so a failure travels as an `Error` carrying that
 * text verbatim and the UI renders `err.message` without a second mapping.
 *
 * The types come from `lib/linear.ts` as a *type-only* import: that module
 * reads `process.env` and holds the API key handling, and none of it belongs in
 * the client bundle.
 */
export async function fetchLinearTeams(): Promise<LinearTeam[]> {
  let response: Response
  try {
    response = await fetch('/api/linear/projects', { cache: 'no-store' })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) throw new Error(errorMessage(body))
  if (!isTeams(body)) throw new Error('El servidor devolvió una respuesta inesperada.')

  return body.teams
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudieron cargar los proyectos de Linear.'
}

function isTeams(body: unknown): body is { teams: LinearTeam[] } {
  if (typeof body !== 'object' || body === null) return false
  const { teams } = body as { teams?: unknown }
  return Array.isArray(teams) && teams.every(isTeam)
}

function isTeam(team: unknown): team is LinearTeam {
  if (typeof team !== 'object' || team === null) return false
  const { id, name, key, projects } = team as Record<string, unknown>
  return (
    typeof id === 'string' &&
    typeof name === 'string' &&
    typeof key === 'string' &&
    Array.isArray(projects)
  )
}
