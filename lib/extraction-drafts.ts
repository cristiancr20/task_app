/**
 * What an extraction becomes once it is kept: the drafts of that note.
 *
 * It is a small mapping, and it lives on its own rather than inside the task
 * table for one reason — a note extracted by the batch queue has to end up
 * *exactly* as if it had been extracted by hand, and «exactly» only holds as a
 * promise if both paths build the state with the same function instead of with
 * two pieces of code that happen to agree today.
 *
 * Nothing here reads the filesystem, and nothing here mints keys: the ids come
 * from whoever is calling, because the table and the queue each keep their own
 * counter (`lib/draft-ids.ts`) and a row key only has to be unique inside the
 * note it belongs to.
 */

import type { DraftsState } from './drafts-store'
import type { ExtractionResult } from './extractors/task'

/**
 * The stored state of a note whose extraction has just come back.
 *
 * Three things are decided here and are true of every extraction, whoever ran
 * it:
 *
 * - Every task starts **included**. Curating is opting out, never opting in.
 * - The rows *are* the baseline, so the change count starts at zero and the
 *   distance from it is exactly what the user has edited since.
 * - The other three lists replace the previous ones wholesale. They came out
 *   of this reading of the transcript, and showing them beside rows from
 *   another one would be two different meetings on the same screen.
 */
export function draftsFromExtraction(
  result: ExtractionResult,
  nextId: () => string,
): DraftsState {
  const rows = result.tasks.map((task) => ({ ...task, id: nextId(), include: true }))

  return {
    rows,
    // The very same array: nothing edits a row in place — the table replaces
    // the row object — so the baseline cannot be disturbed by an edit, and the
    // two are stored as one list twice rather than as two copies to keep apart.
    baseline: rows,
    extracted: true,
    decisions: result.decisions,
    risks: result.risks,
    openQuestions: result.openQuestions,
  }
}
