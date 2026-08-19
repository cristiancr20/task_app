import type { DuplicateCheckScope, ExistingIssue, LinearTeam } from './linear'

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

/**
 * `GET /api/linear/issues` as seen from the browser: what already exists in the
 * destination, so the tasks about to be pushed can be checked against it.
 *
 * `projectId` rides along only when there is one — an empty parameter would
 * read as a project called `''` rather than as «the whole team».
 */
export async function fetchLinearIssues(scope: DuplicateCheckScope): Promise<ExistingIssue[]> {
  const params = new URLSearchParams({ teamId: scope.teamId })
  const projectId = scope.projectId?.trim()
  if (projectId) params.set('projectId', projectId)

  let response: Response
  try {
    response = await fetch(`/api/linear/issues?${params}`, { cache: 'no-store' })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) throw new Error(issuesErrorMessage(body))
  if (!isIssues(body)) throw new Error('El servidor devolvió una respuesta inesperada.')

  return body.issues
}

function issuesErrorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudieron cargar los issues de Linear.'
}

function isIssues(body: unknown): body is { issues: ExistingIssue[] } {
  if (typeof body !== 'object' || body === null) return false
  const { issues } = body as { issues?: unknown }
  return Array.isArray(issues) && issues.every(isIssue)
}

function isIssue(issue: unknown): issue is ExistingIssue {
  if (typeof issue !== 'object' || issue === null) return false
  const { id, identifier, title, url, stateName, closed } = issue as Record<string, unknown>
  return (
    typeof id === 'string' &&
    typeof identifier === 'string' &&
    typeof title === 'string' &&
    typeof url === 'string' &&
    typeof stateName === 'string' &&
    typeof closed === 'boolean'
  )
}
