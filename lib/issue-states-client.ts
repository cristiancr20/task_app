import type { IssueState, IssueStateType } from './linear'

const ISSUE_STATE_TYPES: readonly IssueStateType[] = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
]

/**
 * `POST /api/linear/issue-states` as seen from the browser: what Linear says
 * today about the issues one note already created.
 *
 * Only the path travels. The ids are in the push history and the API key is in
 * the config, both of them server state — the browser could not name either
 * even if it wanted to.
 *
 * Same contract as `fetchLinearIssues`, `fetchDrafts` and `fetchTranscript`:
 * the route already words its refusals for the user, so a failure travels as an
 * `Error` carrying that text verbatim and the UI renders `err.message` without
 * a second mapping. The types come from `lib/linear.ts` as a *type-only*
 * import, so the module that handles the API key never reaches the bundle.
 *
 * A note that was never pushed answers `[]`, not an error: «nothing to report»
 * is the normal case for most notes.
 */
export async function fetchIssueStates(relPath: string): Promise<IssueState[]> {
  let response: Response
  try {
    response = await fetch('/api/linear/issue-states', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: relPath }),
      cache: 'no-store',
    })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) throw new Error(errorMessage(body))
  if (!isIssueStates(body)) throw new Error('El servidor devolvió una respuesta inesperada.')

  return body.states
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudo consultar el estado de los issues en Linear.'
}

function isIssueStates(body: unknown): body is { states: IssueState[] } {
  if (typeof body !== 'object' || body === null) return false
  const { states } = body as { states?: unknown }
  return Array.isArray(states) && states.every(isIssueState)
}

/**
 * One reported state. `stateType` is checked against the union rather than
 * merely being a string: it is what the counters group by, and a value outside
 * the union would be counted as nothing at all. The route reads it through
 * `fetchIssueStates`, which already folds anything unknown into `unstarted`,
 * so a body that fails this is a body that did not come from the route.
 */
function isIssueState(state: unknown): state is IssueState {
  if (typeof state !== 'object' || state === null) return false
  const { id, identifier, title, url, stateName, stateType } = state as Record<string, unknown>
  return (
    typeof id === 'string' &&
    typeof identifier === 'string' &&
    typeof title === 'string' &&
    typeof url === 'string' &&
    typeof stateName === 'string' &&
    ISSUE_STATE_TYPES.some((type) => type === stateType)
  )
}
