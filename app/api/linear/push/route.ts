import { errorResponse, HttpError, jsonBody, pathOf, requireContextRoot } from '@/lib/api'
import { PRIORITIES, normalizeDueDate, type Priority } from '@/lib/extractors/task'
import { runPush, type PushPlan } from '@/lib/linear-push'
import type { PushEvent, PushTaskInput, PushedIssue } from '@/lib/push-events'
import { addHistoryEntry, getConfig } from '@/lib/store'
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

    const events = runPush(apiKey, plan, { meetingTitle: meta.title, date: meta.date })
    return streamEvents(recordingHistory(events, relPath, plan))
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
    // A date Linear would refuse is dropped, not rejected: the row is one of
    // many, and losing its deadline is worth far less than losing the push.
    dueDate: normalizeDueDate(task.dueDate),
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

/**
 * Pass the events through, remembering what got created, and append them to the
 * history of the note when the run is over.
 *
 * It is written here and not by the browser because what exists in Linear is
 * what the *server* saw created: a tab closed mid-run, a dropped connection or
 * a `failed` row the client never read would otherwise lose issues that do
 * exist, and the next visit would offer to create them a second time. Hence the
 * `finally` — an abort, an unexpected throw and a cancelled stream all still
 * record the issues created up to that point, and only those (a task that
 * failed never yields `created`, so it is never written).
 *
 * A failure to write the history does not break the run: the issues are already
 * in Linear, and losing the notice is worth less than losing the last events of
 * the stream.
 *
 * The destination comes from the validated `plan` and not from the body again:
 * it is the team and project the issues were actually created under, which is
 * what makes «¿qué queda pendiente de este proyecto?» answerable later.
 */
async function* recordingHistory(
  events: AsyncGenerator<PushEvent>,
  relPath: string,
  plan: PushPlan,
): AsyncGenerator<PushEvent> {
  const issues: PushedIssue[] = []

  try {
    for await (const event of events) {
      if (event.type === 'created') issues.push(event.issue)
      yield event
    }
  } finally {
    if (issues.length > 0) {
      try {
        addHistoryEntry(relPath, {
          pushedAt: new Date().toISOString(),
          issues,
          teamId: plan.teamId,
          projectId: plan.projectId,
        })
      } catch (err) {
        console.error('No se pudo guardar el historial de envíos:', err)
      }
    }
  }
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
