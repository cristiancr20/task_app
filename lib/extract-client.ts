import type {
  ExtractedDecision,
  ExtractedQuestion,
  ExtractedRisk,
  ExtractedTask,
  ExtractionResult,
} from './extractors/task'

/**
 * `POST /api/extract` as seen from the browser.
 *
 * Same contract as `fetchFolder` and `fetchTranscript`: the route already
 * answers user-facing Spanish for everything it knows about (no context root,
 * no model configured, the provider's own refusal), so a failure travels as an
 * `Error` carrying that text verbatim and the table renders `err.message`
 * without a second mapping.
 *
 * Which provider runs is server state — the body carries only the path.
 *
 * The four lists arrive at the top level of the answer. Only `tasks` decides
 * whether the answer is usable at all: it is the list that becomes issues, and
 * a meeting that decided nothing is an ordinary meeting, so the other three
 * are read as empty when they are absent rather than as a broken response.
 */
export async function runExtraction(relPath: string): Promise<ExtractionResult> {
  let response: Response
  try {
    response = await fetch('/api/extract', {
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

  const tasks = taskList(body)
  if (!tasks) throw new Error('El servidor devolvió una respuesta inesperada.')

  const answer = body as Record<string, unknown>

  return {
    tasks,
    decisions: list<ExtractedDecision>(answer.decisions),
    risks: list<ExtractedRisk>(answer.risks),
    openQuestions: list<ExtractedQuestion>(answer.openQuestions),
  }
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudieron generar las tareas.'
}

/** The rows the route sends, or null when the answer is not the expected shape. */
function taskList(body: unknown): ExtractedTask[] | null {
  if (typeof body !== 'object' || body === null) return null
  const { tasks } = body as { tasks?: unknown }
  return Array.isArray(tasks) ? (tasks as ExtractedTask[]) : null
}

/** One of the three lists that never reach Linear. Absent means empty. */
function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}
