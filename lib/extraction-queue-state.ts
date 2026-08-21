/**
 * Where the batch run stands, as a pure reducer over the events of
 * `lib/extraction-queue.ts`.
 *
 * The run is a generator and the view is a list of rows, and this is what turns
 * one into the other: a status, a result per note, what is being processed
 * right now and how the tanda ended. It is kept apart from the run itself for
 * the same reason `lib/inbox-state.ts` is kept apart from the fetch — the
 * interesting rules («una nota que falla se marca y la cola sigue», «lo que la
 * cancelación no llegó a lanzar queda sin lanzar», «una nota a medias cuando el
 * bucle se rompe no puede quedar girando para siempre») are then unit tests
 * over a function instead of stories about the network.
 *
 * The state deliberately holds **no counts**: the tally is derived from the
 * results (`queueTally`), so the summary and the rows can never disagree about
 * how the tanda went. The run's own `done` event carries the same three
 * numbers because that is its contract with any other consumer; here it only
 * marks the run over.
 */

import type { QueueEvent, QueueNote, QueueStopReason } from './extraction-queue'

/** How one note of the tanda ended up. A note with no result was never attempted. */
export type QueueNoteResult =
  | { state: 'extracting' }
  | { state: 'extracted'; tasks: number }
  | { state: 'failed'; error: string }

/**
 * `idle` is «no hay tanda»; `cancelling` is «se ha pedido parar y la nota en
 * curso sigue», which is a state of its own because it is the one moment where
 * the honest thing to show is neither «corriendo» nor «terminada».
 */
export type QueueStatus = 'idle' | 'running' | 'cancelling' | 'finished'

/** Why the run ended before its last note, and what to say about it. */
export type QueueStop = {
  reason: QueueStopReason
  /** Already worded for the user; null when the user asked for it themselves. */
  error: string | null
}

export type QueueState = {
  status: QueueStatus
  /** The notes of this tanda, in the order they are processed. */
  notes: readonly QueueNote[]
  /** Results by `relPath`. A note that is not here has not been attempted. */
  results: Readonly<Record<string, QueueNoteResult>>
  /** What is being extracted right now, for «Extrayendo 2 de 5». */
  progress: { index: number; total: number; title: string } | null
  /** Set only when the run gave up early. */
  stopped: QueueStop | null
}

export type QueueAction =
  /** A tanda has been launched over these notes, in this order. */
  | { type: 'started'; notes: readonly QueueNote[] }
  | { type: 'event'; event: QueueEvent }
  /** «Cancelar»: the note in flight finishes, nothing else is launched. */
  | { type: 'cancelling' }
  /** The driver itself broke — not one note, the loop around them. */
  | { type: 'crashed'; error: string }
  /** «Cerrar» on a finished tanda: back to no tanda at all. */
  | { type: 'dismissed' }

/** No tanda: what the bandeja looks like before anything is launched. */
export const INITIAL_QUEUE: QueueState = {
  status: 'idle',
  notes: [],
  results: {},
  progress: null,
  stopped: null,
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'started':
      // A new tanda forgets the previous one whole — its results belong to the
      // notes it ran on, and half of them are no longer even in the bandeja.
      return { status: 'running', notes: action.notes, results: {}, progress: null, stopped: null }

    case 'cancelling':
      // Only a run that is actually running can be cancelled: pressing it after
      // the last note landed would otherwise leave the tanda saying it was
      // stopped by the user when it had already finished on its own.
      return state.status === 'running' ? { ...state, status: 'cancelling' } : state

    case 'crashed':
      return {
        ...state,
        status: 'finished',
        progress: null,
        results: settle(state.results),
        stopped: { reason: 'error', error: action.error },
      }

    case 'dismissed':
      return state.status === 'finished' ? INITIAL_QUEUE : state

    case 'event':
      return applyQueueEvent(state, action.event)
  }
}

/** Fold one event of the run into the state. */
export function applyQueueEvent(state: QueueState, event: QueueEvent): QueueState {
  switch (event.type) {
    case 'start':
      // The total is already known — they are the notes the tanda was started
      // with — so there is nothing to write. The event exists because the run
      // is a contract of its own, not because this state needs it.
      return state

    case 'extracting':
      return {
        ...state,
        progress: { index: event.index, total: event.total, title: event.title },
        results: { ...state.results, [event.relPath]: { state: 'extracting' } },
      }

    case 'extracted':
      return {
        ...state,
        results: { ...state.results, [event.relPath]: { state: 'extracted', tasks: event.tasks } },
      }

    case 'failed':
      return {
        ...state,
        results: { ...state.results, [event.relPath]: { state: 'failed', error: event.error } },
      }

    case 'stopped':
      return { ...state, stopped: { reason: event.reason, error: event.error } }

    case 'done':
      return { ...state, status: 'finished', progress: null }
  }
}

/** Whether there is a tanda in flight — the one thing that blocks another. */
export function queueBusy(state: QueueState): boolean {
  return state.status === 'running' || state.status === 'cancelling'
}

/** The three numbers the summary is made of, plus what was never launched. */
export type QueueTally = {
  total: number
  extracted: number
  failed: number
  /** Rows the tanda produced across every note that finished. */
  tasks: number
  /** Notes the run never attempted: cancelled or stopped before reaching them. */
  pending: number
}

/**
 * How the tanda is going, counted over its notes rather than accumulated as it
 * ran. Deriving it means a re-render can never show a summary that disagrees
 * with the badges on the rows right above it.
 */
export function queueTally(state: QueueState): QueueTally {
  let extracted = 0
  let failed = 0
  let tasks = 0
  let pending = 0

  for (const note of state.notes) {
    const result = state.results[note.relPath]
    if (!result) {
      pending += 1
    } else if (result.state === 'extracted') {
      extracted += 1
      tasks += result.tasks
    } else if (result.state === 'failed') {
      failed += 1
    }
  }

  return { total: state.notes.length, extracted, failed, tasks, pending }
}

/** `Extrayendo 2 de 5`: what the queue is on right now. */
export function queueProgressLabel(progress: { index: number; total: number }): string {
  return `Extrayendo ${progress.index} de ${progress.total}`
}

/**
 * How the tanda went, in one line: `3 extraídas · 1 falló · 21 tareas`.
 *
 * The three numbers are always said, zeros included — «ninguna falló» is the
 * answer to a question the user is going to ask, and a summary that only
 * mentions failures when there are some makes their absence something the user
 * has to infer. What was never launched is added only when it exists, because
 * it only can after a cancellation or a stop.
 */
export function queueSummaryLabel(tally: QueueTally): string {
  const parts = [
    tally.extracted === 1 ? '1 extraída' : `${tally.extracted} extraídas`,
    tally.failed === 0 ? 'ninguna falló' : tally.failed === 1 ? '1 falló' : `${tally.failed} fallaron`,
    tally.tasks === 0 ? 'ninguna tarea' : tally.tasks === 1 ? '1 tarea' : `${tally.tasks} tareas`,
  ]

  if (tally.pending > 0) {
    parts.push(tally.pending === 1 ? '1 sin lanzar' : `${tally.pending} sin lanzar`)
  }

  return parts.join(' · ')
}

/**
 * `5 tareas`: what one note of the tanda produced, for its row.
 *
 * Zero is worded rather than written as a number: «0 tareas» on a row that
 * just ran reads as a failure, and it is not one — a note the model found
 * nothing in is an ordinary answer, and the note is extracted all the same.
 */
export function extractedTasksLabel(tasks: number): string {
  if (tasks === 0) return 'sin tareas'
  return tasks === 1 ? '1 tarea' : `${tasks} tareas`
}

/** `Extraer 3 notas`: the button that launches the tanda, with its number. */
export function extractButtonLabel(count: number): string {
  return count === 1 ? 'Extraer 1 nota' : `Extraer ${count} notas`
}

/**
 * A note left mid-extraction when the loop itself broke.
 *
 * Unlike the push, nothing is at stake in Linear here — the worst case is a
 * model call whose answer nobody read — so the row says the run was
 * interrupted and the note simply stays pending, which is what it is.
 */
function settle(results: Readonly<Record<string, QueueNoteResult>>): Record<string, QueueNoteResult> {
  const settled: Record<string, QueueNoteResult> = {}
  for (const [relPath, result] of Object.entries(results)) {
    settled[relPath] =
      result.state === 'extracting'
        ? { state: 'failed', error: 'Se interrumpió la cola mientras se extraía esta nota.' }
        : result
  }
  return settled
}
