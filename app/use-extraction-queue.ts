'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'

import { createDraftIds } from '@/lib/draft-ids'
import { saveDrafts } from '@/lib/drafts-client'
import type { DraftsState } from '@/lib/drafts-store'
import { runExtraction } from '@/lib/extract-client'
import { draftsFromExtraction } from '@/lib/extraction-drafts'
import { type QueueNote, runExtractionQueue } from '@/lib/extraction-queue'
import {
  INITIAL_QUEUE,
  queueBusy,
  queueReducer,
  type QueueState,
} from '@/lib/extraction-queue-state'

export type ExtractionQueueApi = {
  state: QueueState
  /** A tanda is in flight — which is what stops a second one being launched. */
  busy: boolean
  /** Launch a tanda. Answers whether it started, so the caller can react. */
  start: (notes: readonly QueueNote[]) => boolean
  /** «Cancelar»: the note in flight finishes, nothing else is launched. */
  cancel: () => void
  /** «Cerrar» on the summary of a finished tanda. */
  dismiss: () => void
}

/**
 * The row keys of the notes the queue extracts.
 *
 * A counter of its own rather than the task table's: a key only has to be
 * unique inside the note it belongs to, and the two never build the same
 * note's rows at the same time — what the queue writes is adopted by the table
 * through `useTaskDrafts#adopt`, which reserves these ids there.
 */
const ids = createDraftIds()

/**
 * The batch extraction, as the page runs it.
 *
 * All the sequencing lives in `lib/extraction-queue.ts` and all the state in
 * `lib/extraction-queue-state.ts`; what is left here is what is genuinely
 * React — the two clients the run is made of, a reducer, and the two refs that
 * make «cancelar» and «no lances dos tandas» possible without re-creating the
 * run on every render.
 *
 * It is called from `Explorer` rather than from the bandeja's own view, and
 * that is the whole of «navegar a otra vista no cancela la cola»: the view is
 * unmounted the moment the search takes the column, while the explorer around
 * it stays for as long as the page does. Coming back re-renders the very same
 * state, mid-tanda included.
 */
export function useExtractionQueue(
  /**
   * Called for every note whose drafts have just been written, with what was
   * stored. The note has changed on the server — it is «extraída, sin enviar»
   * now — so whatever shows it has to hear about it.
   */
  onExtracted?: (relPath: string, stored: DraftsState) => void,
): ExtractionQueueApi {
  const [state, dispatch] = useReducer(queueReducer, INITIAL_QUEUE)

  // Through a ref so a tanda already in flight still calls the current
  // callback, and so `start` does not have to be rebuilt every render.
  const notify = useRef(onExtracted)
  useEffect(() => {
    notify.current = onExtracted
  })

  /** Read between notes by the run itself. A ref, because the loop is not React. */
  const cancelled = useRef(false)
  /**
   * Whether a run is in flight, as the *loop* knows it rather than as the
   * state does: `start` is called from an event handler that may not have seen
   * the dispatch that follows it, and a model that cannot serve two requests
   * at once is not a place to be optimistic.
   */
  const running = useRef(false)

  const start = useCallback((notes: readonly QueueNote[]): boolean => {
    if (running.current || notes.length === 0) return false

    running.current = true
    cancelled.current = false
    // A copy: the caller's list is derived from the bandeja's rows, which
    // reload while the tanda runs. The tanda is what was chosen when it was
    // launched, and its order is the order the user was looking at.
    const tanda = notes.map((note) => ({ relPath: note.relPath, title: note.title }))
    dispatch({ type: 'started', notes: tanda })

    void (async () => {
      try {
        for await (const event of runExtractionQueue(tanda, {
          extract: runExtraction,
          store: async (relPath, result) => {
            // Through `/api/drafts` like every other save, and with the same
            // builder the task table uses: a note extracted here is stored
            // exactly as one extracted by hand. What comes back is what the
            // store actually wrote, which is what the page adopts.
            const stored = await saveDrafts(relPath, draftsFromExtraction(result, ids.next))
            notify.current?.(relPath, stored)
          },
          cancelled: () => cancelled.current,
        })) {
          dispatch({ type: 'event', event })
        }
      } catch (err) {
        // Not one note failing — the run itself. Every note has its own try
        // inside the generator, so getting here means something broke around
        // them, and a tanda that stopped without saying so would look hung.
        dispatch({ type: 'crashed', error: errorMessage(err) })
      } finally {
        running.current = false
      }
    })()

    return true
  }, [])

  const cancel = useCallback(() => {
    // The flag is what stops the *next* note; the one in flight has already
    // cost its minutes and is left to finish and be stored.
    cancelled.current = true
    dispatch({ type: 'cancelling' })
  }, [])

  const dismiss = useCallback(() => dispatch({ type: 'dismissed' }), [])

  return { state, busy: queueBusy(state), start, cancel, dismiss }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'Se interrumpió la cola de extracción.'
}
