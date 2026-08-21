/**
 * The batch run: several notes extracted one after another, reported as it
 * goes.
 *
 * It is an async generator for the same reason `lib/linear-push.ts` is one —
 * the run is minutes long and the user has to see it advance — and it is the
 * same shape on purpose: a `start`, one event per note, a `stopped` in front of
 * the `done` when it gave up early. What differs is where it runs. The push
 * needs the Linear key, so its generator lives on the server and the browser
 * reads NDJSON; an extraction is already a route (`/api/extract`) and the
 * drafts are already a route (`/api/drafts`), so the queue is driven from the
 * browser and this module only sequences those two calls.
 *
 * Three rules are what the module is for, and none of them belongs in a
 * component:
 *
 * - **One note at a time, never two.** The extraction may be running against a
 *   model on the user's own machine, which does not serve two requests at once
 *   — the second would not go twice as fast, it would make both time out. The
 *   loop awaits every note before starting the next, which is a property a
 *   test can hold this module to.
 * - **A failure is about one note until it is about all of them.** A note that
 *   fails is marked and the queue carries on; `MAX_CONSECUTIVE_FAILURES` in a
 *   row stops it.
 * - **Cancelling never throws work away.** It is read between notes, so what
 *   has been extracted is kept and what is pending is simply not launched.
 *
 * Nothing here imports React, the filesystem or `node:`: it takes the two calls
 * it needs as options, so the whole run is exercised with fakes.
 */

import type { ExtractionResult } from './extractors/task'

/**
 * How many notes failing in a row mean the queue is not going to recover.
 *
 * The same number and the same reasoning as the push (`lib/linear-push.ts`): a
 * single note can fail on its own — a transcript the model chokes on, a
 * hiccup — but three in a row is the provider being down, the API key being
 * wrong or Ollama not running, and grinding through the remaining twenty would
 * only produce twenty copies of the same error, each after a full timeout.
 */
export const MAX_CONSECUTIVE_FAILURES = 3

/** What the queue needs of a note: the path it runs on and the title it shows. */
export type QueueNote = {
  /** Path relative to the context root — the key the drafts are stored under. */
  relPath: string
  title: string
}

/** Why a run ended before reaching the last note. */
export type QueueStopReason =
  /** `MAX_CONSECUTIVE_FAILURES` notes failed one after another. */
  | 'failures'
  /** The user asked for it. Whatever was already extracted stays extracted. */
  | 'cancelled'
  /** The run itself broke — not one note, the loop. Reported by the driver. */
  | 'error'

/**
 * One step of the run, in the order it happens: `start`, then
 * `extracting`/`extracted`|`failed` per note, then `done` — with `stopped` in
 * front of `done` when the queue gave up early.
 */
export type QueueEvent =
  /** How many notes the run is going to attempt. */
  | { type: 'start'; total: number }
  /** `index` is 1-based, so it reads «Extrayendo 2 de 5». */
  | { type: 'extracting'; relPath: string; index: number; total: number; title: string }
  /** The note's drafts are stored. `tasks` is how many rows they hold. */
  | { type: 'extracted'; relPath: string; tasks: number }
  | { type: 'failed'; relPath: string; error: string }
  /** The run stopped early; the notes it never reached stay pending. */
  | { type: 'stopped'; reason: QueueStopReason; error: string | null }
  /** The tally of the whole run, cancelled or not. */
  | { type: 'done'; extracted: number; failed: number; tasks: number }

/** The two calls the run is made of, plus the way out of it. */
export type QueueDeps = {
  /** Extract one note. `runExtraction` from `lib/extract-client.ts`. */
  extract: (relPath: string) => Promise<ExtractionResult>
  /**
   * Keep what came out as that note's drafts, exactly as a manual extraction
   * does — see `lib/extraction-drafts.ts`.
   *
   * It is awaited *inside* the note's attempt because storing is part of
   * extracting it: a result nobody managed to write is not «extraída», the
   * bandeja will not move the note, and calling it a success would be the one
   * lie the summary must not tell.
   */
  store: (relPath: string, result: ExtractionResult) => Promise<void>
  /** Whether the user has asked to stop. Read before every note. */
  cancelled?: () => boolean
}

/**
 * Run the tanda, yielding one event per step.
 *
 * Cancelling is checked between notes rather than being an abort: an
 * extraction in flight has already cost its minutes, so it is allowed to
 * finish and be stored — «lo ya extraído se conserva» — and the queue stops
 * before launching the next one. A cancelled run still reports its `done`,
 * because half a tanda has a summary too.
 */
export async function* runExtractionQueue(
  notes: readonly QueueNote[],
  { extract, store, cancelled }: QueueDeps,
): AsyncGenerator<QueueEvent> {
  const total = notes.length
  yield { type: 'start', total }

  let index = 0
  let extracted = 0
  let failed = 0
  let tasks = 0
  let consecutiveFailures = 0

  for (const note of notes) {
    if (cancelled?.()) {
      yield { type: 'stopped', reason: 'cancelled', error: null }
      break
    }

    index += 1
    yield { type: 'extracting', relPath: note.relPath, index, total, title: note.title }

    try {
      const result = await extract(note.relPath)
      await store(note.relPath, result)

      extracted += 1
      tasks += result.tasks.length
      consecutiveFailures = 0
      yield { type: 'extracted', relPath: note.relPath, tasks: result.tasks.length }
    } catch (err) {
      failed += 1
      consecutiveFailures += 1
      yield { type: 'failed', relPath: note.relPath, error: message(err) }

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        yield {
          type: 'stopped',
          reason: 'failures',
          error: `Han fallado ${MAX_CONSECUTIVE_FAILURES} notas seguidas, así que la cola se ha detenido: el problema no es de una nota concreta. Revisa el error, corrígelo y vuelve a lanzar las que faltan.`,
        }
        break
      }
    }
  }

  yield { type: 'done', extracted, failed, tasks }
}

/**
 * What the row shows as its failure. Both calls the run makes come from
 * `lib/*-client.ts`, which already answer the route's Spanish verbatim, so
 * there is nothing to map here — only a fallback for a failure that carried no
 * message at all.
 */
function message(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'No se pudo extraer la nota.'
}
