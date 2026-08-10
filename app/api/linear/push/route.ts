import { errorResponse, HttpError, jsonBody, pathOf, requireContextRoot } from '@/lib/api'
import { PRIORITIES, type Priority } from '@/lib/extractors/task'
import { runPush, type PushPlan } from '@/lib/linear-push'
import type { PushEvent, PushTaskInput } from '@/lib/push-events'
import { getConfig } from '@/lib/store'
import { readTranscript } from '@/lib/transcripts'

/**
 * `POST /api/linear/push` — creates the parent issue and the selected tasks in
 * Linear, streaming one NDJSON event per step.
 *
 * It streams rather than answering once at the end because the run is a
 * sequence of round trips to a remote API: a dozen tasks take long enough that
 * a silent spinner is indistinguishable from a hang, and the events are also
 * what tells the UI which rows to offer for retry.
 *
 * Everything that can be refused is refused *before* the first byte goes out —
 * no key, no context root, an unusable plan — because once the stream is open
 * the status code is already 200. What Linear itself refuses travels inside the
 * stream as a per-row `failed` event, which is the point of the story: one bad
 * task does not sink the run.
 */
export async function POST(request: Request): Promise<Response> {
  let relPath = ''

  try {
    const payload = await jsonBody(request)
    relPath = pathOf(payload)
    // Same guard as `/api/extract`: the explorer only ever lists `.md`.
    if (!relPath.toLowerCase().endsWith('.md')) {
      throw new HttpError(400, `Solo se pueden leer archivos .md: ${relPath}`)
    }

    // The key is server state, like the provider in `/api/extract` — the
    // browser sends the destination, never the credential.
    const apiKey = getConfig().linearApiKey.trim()
    if (!apiKey) {
      throw new HttpError(
        400,
        'No hay ninguna API key de Linear guardada. Guárdala en /settings.',
      )
    }

    const plan = readPlan(payload)
    // The traceability block names the meeting, so it is read from the note
    // itself rather than trusted from the browser.
    const { meta } = readTranscript(requireContextRoot(), relPath)

    return streamEvents(runPush(apiKey, plan, { meetingTitle: meta.title, date: meta.date }))
  } catch (err) {
    return errorResponse(err, relPath)
  }
}

/**
 * The plan out of the request body. Only the *shape* is enforced here: a task
 * Linear will refuse (an empty title, say) is a row that fails, not a request
 * that is rejected, so the other tasks still get created.
 */
function readPlan(payload: unknown): PushPlan {
  const body = record(payload)

  const teamId = string(body.teamId).trim()
  if (!teamId) {
    throw new HttpError(400, 'Falta el equipo de Linear al que enviar las tareas.')
  }

  const tasks = Array.isArray(body.tasks) ? body.tasks.map(readTask) : null
  if (!tasks) {
    throw new HttpError(400, 'El cuerpo de la petición no trae la lista de tareas.')
  }
  if (tasks.length === 0) {
    throw new HttpError(400, 'No hay ninguna tarea que crear.')
  }

  const parentTitle = string(body.parentTitle).trim()

  return {
    teamId,
    projectId: string(body.projectId).trim() || null,
    parentTitle: parentTitle || null,
    parentId: string(body.parentId).trim() || null,
    tasks,
  }
}

function readTask(input: unknown): PushTaskInput {
  const task = record(input)

  const id = string(task.id).trim()
  if (!id) {
    throw new HttpError(400, 'Una de las tareas llega sin identificador de fila.')
  }

  return {
    id,
    title: string(task.title).trim(),
    description: string(task.description),
    priority: priority(task.priority),
    mentioned: string(task.mentioned).trim() || null,
    evidence: string(task.evidence),
  }
}

function record(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new HttpError(400, 'El cuerpo de la petición no tiene el formato esperado.')
  }
  return input as Record<string, unknown>
}

/** Absent, null and the wrong type all read as «not given». */
function string(input: unknown): string {
  return typeof input === 'string' ? input : ''
}

function priority(input: unknown): Priority {
  return (PRIORITIES as readonly string[]).includes(string(input))
    ? (input as Priority)
    : 'none'
}

const encoder = new TextEncoder()

/**
 * The events as NDJSON, one JSON object per line — the format the browser can
 * act on line by line without waiting for the body to end.
 *
 * `pull` advances the run only when the consumer asks for the next line, so a
 * browser that navigates away stops the push instead of creating issues nobody
 * is going to see. An unexpected throw is reported as an `aborted` event rather
 * than as a broken stream: the client would otherwise have created issues it
 * cannot name.
 */
function streamEvents(events: AsyncGenerator<PushEvent>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let next: IteratorResult<PushEvent>
      try {
        next = await events.next()
      } catch (err) {
        console.error('Error inesperado durante el envío a Linear:', err)
        controller.enqueue(line({ type: 'aborted', error: 'El envío se interrumpió por un error inesperado.' }))
        controller.close()
        return
      }

      if (next.done) controller.close()
      else controller.enqueue(line(next.value))
    },
    async cancel() {
      await events.return(undefined)
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
    },
  })
}

function line(event: PushEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`)
}
