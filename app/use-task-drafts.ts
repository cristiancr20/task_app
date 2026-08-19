'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { createDraftIds } from '@/lib/draft-ids'
import { countManualChanges } from '@/lib/drafts-changes'
import { fetchDrafts, saveDrafts } from '@/lib/drafts-client'
import { mergeDrafts } from '@/lib/drafts-merge'
import type { DraftsState } from '@/lib/drafts-store'
import { extractTasks } from '@/lib/extract-client'
import type { ExtractedTask, Priority } from '@/lib/extractors/task'
import { createSaveQueue, type SaveQueue } from '@/lib/save-queue'

/**
 * One row of the table: an extracted task the user can still edit, plus the two
 * things only the table knows — a stable key for React and whether the row is
 * going to Linear.
 */
export type TaskDraft = ExtractedTask & {
  id: string
  include: boolean
}

/** What is known about one transcript's tasks. */
export type TaskDraftState = {
  rows: TaskDraft[]
  /**
   * The rows exactly as the last extraction returned them. Never edited, so the
   * distance between it and `rows` *is* the list of manual changes a regenerate
   * would throw away. Empty before the first extraction, which makes rows added
   * by hand beforehand count as changes too — regenerating discards those all
   * the same. Persisted with the rows, so the count survives a reload.
   */
  baseline: TaskDraft[]
  /** An extraction is in flight for this file. */
  generating: boolean
  /** Message of the last failed extraction. The rows are left untouched. */
  error: string | null
  /** An extraction finished, so «ninguna tarea» means the model found none. */
  extracted: boolean
  /** «Generar tareas» is waiting for the user to accept losing their edits. */
  confirming: boolean
  /** The stored drafts of this file are on their way. */
  loading: boolean
  /** Message of the last failed load. Whatever is in memory is kept. */
  loadError: string | null
}

const EMPTY: TaskDraftState = {
  rows: [],
  baseline: [],
  generating: false,
  error: null,
  extracted: false,
  confirming: false,
  loading: false,
  loadError: null,
}

/**
 * What a file looks like between being selected and its drafts arriving. A
 * selected file always has a load either running or already done, so this is
 * what the table renders for the first frame — showing `EMPTY` there would
 * claim «aún no hay tareas» about a file whose tasks are still being read.
 */
const LOADING: TaskDraftState = { ...EMPTY, loading: true }

/** Long enough that typing a word is one save, short enough to feel immediate. */
const SAVE_DELAY_MS = 500

// The count itself is pure row arithmetic and lives in `lib/drafts-changes`,
// where the test suite can reach it; it is re-exported here because the table
// asks the hook's own module for it, and `TaskDraft` is a `DraftRow`.
export { countManualChanges, type ManualChanges } from '@/lib/drafts-changes'

/**
 * Row keys. They outlive the page now that drafts are restored from disk, so
 * the counter is reserved past whatever comes back — see `lib/draft-ids`.
 */
const ids = createDraftIds()

/**
 * The task table's state, for every transcript visited since the page loaded.
 *
 * Drafts are kept in a map keyed by path rather than inside the table, so
 * switching to another file and coming back shows the edits again — the whole
 * point of curating before pushing. That map is now a cache in front of
 * `.data/drafts.json`: a file with no state in memory loads its stored drafts
 * once, and every change to the rows is written back, debounced. The extraction
 * itself is still never re-run on selection — it costs minutes and money, which
 * is exactly why its result is worth persisting.
 */
export function useTaskDrafts(relPath: string | null): {
  /** The selected file's drafts, or undefined when no file is selected. */
  state: TaskDraftState | undefined
  /** «Generar tareas»: extracts, or asks first when there are manual changes. */
  generate: () => void
  /** «Descartar y regenerar» in the confirmation. */
  confirmGenerate: () => void
  /** «Cancelar» in the confirmation — the table is left exactly as it was. */
  cancelGenerate: () => void
  updateRow: (id: string, changes: Partial<TaskDraft>) => void
  /** Uncheck several rows at once — what the duplicate check asks for. */
  excludeRows: (ids: readonly string[]) => void
  removeRow: (id: string) => void
  addRow: () => void
  /** «Reintentar» after a failed load. */
  retryLoad: () => void
} {
  const [byPath, setByPath] = useState<Record<string, TaskDraftState>>({})

  // One queue for the whole page: the note a save belongs to is the key it was
  // scheduled under, so a slow write never lands on the file now on screen.
  const queueRef = useRef<SaveQueue<DraftsState> | null>(null)
  const queue = (queueRef.current ??= createSaveQueue<DraftsState>({
    delay: SAVE_DELAY_MS,
    save: saveDrafts,
    // A save that fails costs nothing on screen: the rows are still in memory
    // and still editable, and the next edit schedules another attempt. Saying
    // so in a banner would interrupt the curating it did not interrupt.
    onError: (err, path) =>
      console.error(`No se pudieron guardar las tareas de ${path}:`, err),
  }))

  /** Files whose load has been started, so selecting one twice reads disk once. */
  const requested = useRef<Set<string>>(new Set())
  /**
   * Files it is safe to write. A file whose load failed is deliberately absent:
   * its drafts are on disk and unread, and saving the empty table now on screen
   * over them would turn a failed read into lost work.
   */
  const savable = useRef<Set<string>>(new Set())
  /** The durable state last written to (or read from) disk, by file. */
  const savedAt = useRef<Record<string, string>>({})

  const patch = useCallback(
    (path: string, change: (prev: TaskDraftState) => TaskDraftState) => {
      setByPath((prev) => ({ ...prev, [path]: change(prev[path] ?? EMPTY) }))
    },
    [],
  )

  const patchSelected = useCallback(
    (change: (prev: TaskDraftState) => TaskDraftState) => {
      if (relPath) patch(relPath, change)
    },
    [patch, relPath],
  )

  const load = useCallback(
    (path: string) => {
      requested.current.add(path)
      patch(path, (prev) => ({ ...prev, loading: true, loadError: null }))

      // Written under the path it was asked for, like the extraction: a slow
      // read must not pour one note's stored rows into another note's table.
      fetchDrafts(path).then(
        (stored) => {
          // The restored keys are taken out of circulation before any new row
          // can be added, or «Añadir» would mint one that is already on screen.
          ids.reserve([...stored.rows, ...stored.baseline].map((row) => row.id))

          // What was just read is, by definition, saved. Recording it is what
          // keeps the load from being written straight back out.
          savedAt.current[path] = fingerprint(stored)
          savable.current.add(path)

          patch(path, (prev) => ({
            ...prev,
            ...mergeDrafts(durableOf(prev), stored),
            loading: false,
            loadError: null,
          }))
        },
        (err: unknown) =>
          patch(path, (prev) => ({ ...prev, loading: false, loadError: loadError(err) })),
      )
    },
    [patch],
  )

  const run = useCallback(
    (path: string) => {
      patch(path, (prev) => ({ ...prev, generating: true, error: null, confirming: false }))

      // The answer is written under the path it was asked for, so a slow
      // extraction never lands on the file the user has moved on to.
      extractTasks(path).then(
        (tasks) => {
          // The new rows *are* the new baseline, so an accepted regeneration
          // starts the count over at zero.
          const rows = tasks.map(toDraft)
          const stored: DraftsState = { rows, baseline: rows, extracted: true }

          // Straight to disk rather than through the debounce: this is the one
          // result in the app that cost a model call, and the reload that would
          // otherwise lose it is half a second away.
          savable.current.add(path)
          savedAt.current[path] = fingerprint(stored)
          queue.saveNow(path, stored)

          patch(path, (prev) => ({
            ...prev,
            ...stored,
            generating: false,
            error: null,
            confirming: false,
            // There are rows on screen now, so a notice about the ones that
            // could not be read is stale — and they are gone either way.
            loading: false,
            loadError: null,
          }))
        },
        // The previous table survives a failure: the message says what went
        // wrong, and rows the user already edited are not collateral damage —
        // neither are the changes counted against them, since `baseline` is
        // only replaced by an extraction that actually returned something.
        (err: unknown) =>
          patch(path, (prev) => ({ ...prev, generating: false, error: errorMessage(err) })),
      )
    },
    [patch, queue],
  )

  // A file with nothing in memory reads its drafts; one that has been read
  // already (or is being read) is left alone, so coming back to a note shows
  // the edits rather than the last thing written to disk.
  useEffect(() => {
    if (!relPath || requested.current.has(relPath)) return
    load(relPath)
  }, [load, relPath])

  // Every change to the rows ends up here, whichever button made it: the
  // durable part of each file's state is compared with what was last written
  // and the difference is queued. Changes to the transient fields — a spinner,
  // a dialog, an error — serialise identically and never reach the disk.
  useEffect(() => {
    for (const [path, state] of Object.entries(byPath)) {
      if (!savable.current.has(path)) continue

      const stored = durableOf(state)
      const stamp = fingerprint(stored)
      if (savedAt.current[path] === stamp) continue

      savedAt.current[path] = stamp
      queue.schedule(path, stored)
    }
  }, [byPath, queue])

  // Leaving the page is not a reason to lose the last half second of typing.
  useEffect(() => () => queue.flushAll(), [queue])

  const generate = useCallback(() => {
    if (!relPath) return
    // Nothing curated yet — asking would be noise, so the extraction just runs.
    if (countManualChanges(byPath[relPath]).total === 0) {
      run(relPath)
      return
    }
    patch(relPath, (prev) => ({ ...prev, confirming: true }))
  }, [byPath, patch, relPath, run])

  const confirmGenerate = useCallback(() => {
    if (relPath) run(relPath)
  }, [relPath, run])

  const cancelGenerate = useCallback(() => {
    patchSelected((prev) => ({ ...prev, confirming: false }))
  }, [patchSelected])

  const updateRow = useCallback(
    (id: string, changes: Partial<TaskDraft>) => {
      patchSelected((prev) => ({
        ...prev,
        rows: prev.rows.map((row) => (row.id === id ? { ...row, ...changes } : row)),
      }))
    },
    [patchSelected],
  )

  /**
   * One patch rather than a loop of `updateRow`: the duplicate check hands over
   * every row it wants out of the push at once, and a row that is already
   * unchecked keeps its very object so the fingerprint — and with it the save —
   * is not disturbed by a call that changes nothing.
   */
  const excludeRows = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return
      const excluded = new Set(ids)
      patchSelected((prev) => {
        const rows = prev.rows.map((row) =>
          excluded.has(row.id) && row.include ? { ...row, include: false } : row,
        )
        // Every named row was already unchecked, which is the ordinary case
        // once the check has run: returning the state itself keeps the render
        // out of the way as well as the save.
        return rows.every((row, at) => row === prev.rows[at]) ? prev : { ...prev, rows }
      })
    },
    [patchSelected],
  )

  const removeRow = useCallback(
    (id: string) => {
      patchSelected((prev) => ({ ...prev, rows: prev.rows.filter((row) => row.id !== id) }))
    },
    [patchSelected],
  )

  const addRow = useCallback(() => {
    patchSelected((prev) => ({ ...prev, rows: [...prev.rows, blankDraft()] }))
  }, [patchSelected])

  const retryLoad = useCallback(() => {
    if (relPath) load(relPath)
  }, [load, relPath])

  return {
    // A selected file with no entry yet is one whose load is about to start, so
    // it reads as loading rather than as empty.
    state: relPath ? (byPath[relPath] ?? LOADING) : undefined,
    generate,
    confirmGenerate,
    cancelGenerate,
    updateRow,
    excludeRows,
    removeRow,
    addRow,
    retryLoad,
  }
}

/** The part of the state worth a write. The rest describes this session only. */
function durableOf(state: TaskDraftState): DraftsState {
  return { rows: state.rows, baseline: state.baseline, extracted: state.extracted }
}

/**
 * A change detector, not an equality test: it is only ever compared against the
 * previous stamp of the same file, whose rows are the very objects this state
 * was built from, so property order never differs between the two.
 */
function fingerprint(stored: DraftsState): string {
  return JSON.stringify(stored)
}

/** Everything the model returns starts included — curating is opting *out*. */
function toDraft(task: ExtractedTask): TaskDraft {
  return { ...task, id: ids.next(), include: true }
}

/**
 * A row the user is about to type. It has no evidence and nobody was mentioned,
 * because no transcript line backs it — the traceability block will say so.
 */
function blankDraft(): TaskDraft {
  const priority: Priority = 'none'
  return {
    id: ids.next(),
    include: true,
    title: '',
    description: '',
    priority,
    mentioned: null,
    dueDate: null,
    evidence: '',
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'No se pudieron generar las tareas.'
}

function loadError(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'No se pudieron cargar las tareas guardadas.'
}
