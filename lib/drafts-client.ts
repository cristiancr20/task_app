import type { DraftsState } from './drafts-store'
import type { ExtractedDecision, ExtractedQuestion, ExtractedRisk } from './extractors/task'

/**
 * `/api/drafts` as seen from the browser: the two calls that make the task
 * table survive a reload.
 *
 * Same contract as `fetchFolder`, `fetchTranscript` and `runExtraction` — the
 * route already answers user-facing Spanish, so a failure travels as an `Error`
 * carrying that text verbatim — and the same type-only import, so the store
 * (which reads the filesystem) never reaches the client bundle.
 */

/** The drafts stored for a note. A note that has none answers an empty state. */
export async function fetchDrafts(relPath: string): Promise<DraftsState> {
  let response: Response
  try {
    response = await fetch(`/api/drafts?path=${encodeURIComponent(relPath)}`, {
      cache: 'no-store',
    })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  return unwrap(response, 'No se pudieron cargar las tareas guardadas.')
}

/**
 * Replace the stored drafts of a note with `state`, and answer what was stored.
 *
 * The whole table travels on every save rather than a patch: it is what makes
 * the last write of a burst the one that counts, and it is why the caller can
 * drop every save but the newest instead of having to replay them in order.
 */
export async function saveDrafts(relPath: string, state: DraftsState): Promise<DraftsState> {
  let response: Response
  try {
    response = await fetch('/api/drafts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: relPath, ...state }),
      cache: 'no-store',
    })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  return unwrap(response, 'No se pudieron guardar las tareas.')
}

/** Both calls answer a stored state, and fail the same way when they do not. */
async function unwrap(response: Response, fallback: string): Promise<DraftsState> {
  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) throw new Error(errorMessage(body, fallback))
  if (!isDraftsState(body)) throw new Error('El servidor devolvió una respuesta inesperada.')

  return {
    rows: body.rows,
    baseline: body.baseline,
    extracted: body.extracted,
    // A list that is not there is an empty list, never a failure: that is what
    // every state stored before these lists existed looks like, and losing the
    // whole table over three keys the note never had would be absurd.
    decisions: list<ExtractedDecision>(body.decisions),
    risks: list<ExtractedRisk>(body.risks),
    openQuestions: list<ExtractedQuestion>(body.openQuestions),
  }
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return fallback
}

/**
 * The answer's shape, not its contents: the route normalises every row before
 * storing it, so what comes back is already sieved — this only rules out a
 * body that is not a stored state at all.
 */
function isDraftsState(body: unknown): body is DraftsState {
  if (typeof body !== 'object' || body === null) return false
  const { rows, baseline, extracted } = body as Record<string, unknown>
  return Array.isArray(rows) && Array.isArray(baseline) && typeof extracted === 'boolean'
}
