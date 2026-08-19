/**
 * The push run: the parent issue, then every selected task under it, created
 * one at a time and reported as it goes.
 *
 * It is an async generator rather than a function returning a report because
 * the run is the slow part of the app — a dozen sequential round trips to
 * Linear — and the user has to see it advance. The route turns these events
 * into NDJSON lines; nothing else here knows about HTTP.
 */

import { describeError } from './api'
import { createIssue, type IssueSource } from './linear'
import { PARENT_ROW_ID, type PushEvent, type PushRequest, type PushedIssue } from './push-events'

/**
 * How many failures in a row mean the run is not going to recover. A single
 * task can fail on its own (a title Linear rejects, a hiccup); three in a row
 * is the key, the team or the network, and attempting the remaining twenty
 * would only produce twenty copies of the same error.
 */
const MAX_CONSECUTIVE_FAILURES = 3

/** Where the tasks came from, for the traceability block of every issue. */
export type PushSource = {
  meetingTitle: string
  date: string | null
}

/** The plan, already validated by the route. */
export type PushPlan = Omit<PushRequest, 'path'>

/**
 * Create the parent and the tasks, yielding one event per step.
 *
 * A failing task does not stop the run: the next one is still attempted, and
 * the failure is reported against its own row so the retry knows what to send
 * again. A failing *parent* does stop it — every task was meant to hang from it,
 * so creating them loose in the project would leave a mess the user did not ask
 * for and would have to clean up by hand.
 */
export async function* runPush(
  apiKey: string,
  plan: PushPlan,
  source: PushSource,
): AsyncGenerator<PushEvent> {
  const total = plan.tasks.length + (plan.parentTitle ? 1 : 0)
  yield { type: 'start', total }

  let index = 0
  let created = 0
  let failed = 0
  let parentId = plan.parentId?.trim() || null

  if (plan.parentTitle) {
    const title = plan.parentTitle
    index += 1
    yield { type: 'creating', id: PARENT_ROW_ID, index, total, title }

    try {
      // The parent stands for the meeting, not for a task somebody committed
      // to, so it carries no traceability block: there is no line of the
      // transcript that proves it.
      const issue = await createIssue(apiKey, {
        teamId: plan.teamId,
        title,
        projectId: plan.projectId,
      })
      parentId = issue.id
      yield { type: 'created', id: PARENT_ROW_ID, issue: { ...issue, title } }
    } catch (err) {
      yield { type: 'failed', id: PARENT_ROW_ID, title, error: message(err) }
      yield {
        type: 'aborted',
        error:
          'No se pudo crear la tarea padre, así que no se ha creado ninguna tarea. Corrige el error y vuelve a intentarlo.',
      }
      yield { type: 'done', created: 0, failed: 1 }
      return
    }
  }

  let consecutiveFailures = 0

  for (const task of plan.tasks) {
    index += 1
    yield { type: 'creating', id: task.id, index, total, title: task.title }

    try {
      const issue = await createIssue(apiKey, {
        teamId: plan.teamId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        projectId: plan.projectId,
        parentId,
        dueDate: task.dueDate,
        source: sourceOf(task, source),
      })
      created += 1
      consecutiveFailures = 0
      yield { type: 'created', id: task.id, issue: { ...issue, title: task.title } }
    } catch (err) {
      failed += 1
      consecutiveFailures += 1
      yield { type: 'failed', id: task.id, title: task.title, error: message(err) }

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        yield {
          type: 'aborted',
          error: `Han fallado ${MAX_CONSECUTIVE_FAILURES} tareas seguidas, así que el envío se ha detenido: el problema no es de una tarea concreta. Revisa el error, corrígelo y reintenta las fallidas.`,
        }
        break
      }
    }
  }

  yield { type: 'done', created, failed }
}

/** The traceability block of one task: the meeting it came from and its evidence. */
function sourceOf(
  task: { mentioned: string | null; evidence: string },
  source: PushSource,
): IssueSource {
  return {
    meetingTitle: source.meetingTitle,
    date: source.date,
    mentioned: task.mentioned,
    evidence: task.evidence,
  }
}

/**
 * What the row shows as its failure. The run is not a route, so it takes the
 * message out of `describeError` directly — the same Spanish text (and the same
 * pass-through of Linear's own wording) the routes answer with.
 */
function message(err: unknown): string {
  return describeError(err, '').message
}
