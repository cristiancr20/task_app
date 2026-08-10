'use client'

import { useCallback, useState } from 'react'

import { extractTasks } from '@/lib/extract-client'
import type { ExtractedTask, Priority } from '@/lib/extractors/task'

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
   * the same.
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
}

const EMPTY: TaskDraftState = {
  rows: [],
  baseline: [],
  generating: false,
  error: null,
  extracted: false,
  confirming: false,
}

/** How far the table has drifted from the last extraction, in rows. */
export type ManualChanges = {
  edited: number
  added: number
  removed: number
  /** Rows the user touched in any way — what a regenerate would discard. */
  total: number
}

const NO_CHANGES: ManualChanges = { edited: 0, added: 0, removed: 0, total: 0 }

/**
 * The manual changes since the last extraction, counted in rows rather than in
 * keystrokes: a title typed one character at a time is one edited row, and the
 * number has to be one the user recognises before agreeing to lose it.
 *
 * Unchecking «incluir» counts as an edit. It is curation work like any other,
 * and a regenerate wipes it just the same.
 */
export function countManualChanges(state: TaskDraftState | undefined): ManualChanges {
  if (!state) return NO_CHANGES

  const original = new Map(state.baseline.map((row) => [row.id, row]))
  let edited = 0
  let added = 0
  let kept = 0

  for (const row of state.rows) {
    const before = original.get(row.id)
    if (!before) added += 1
    else {
      kept += 1
      if (!sameDraft(before, row)) edited += 1
    }
  }

  const removed = state.baseline.length - kept
  return { edited, added, removed, total: edited + added + removed }
}

function sameDraft(a: TaskDraft, b: TaskDraft): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.priority === b.priority &&
    a.mentioned === b.mentioned &&
    a.evidence === b.evidence &&
    a.include === b.include
  )
}

/** Row keys only have to be unique within the page's lifetime. */
let sequence = 0
const nextId = () => `row-${++sequence}`

/**
 * The task table's state, for every transcript visited since the page loaded.
 *
 * Drafts are kept in a map keyed by path rather than inside the table, so
 * switching to another file and coming back shows the edits again — the whole
 * point of curating before pushing. Nothing here is persisted: a reload starts
 * over, which is also why the extraction is never re-run automatically on
 * selection (it costs minutes and money, unlike reading the file).
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
  removeRow: (id: string) => void
  addRow: () => void
} {
  const [byPath, setByPath] = useState<Record<string, TaskDraftState>>({})

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
          patch(path, () => ({
            rows,
            baseline: rows,
            generating: false,
            error: null,
            extracted: true,
            confirming: false,
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
    [patch],
  )

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

  const removeRow = useCallback(
    (id: string) => {
      patchSelected((prev) => ({ ...prev, rows: prev.rows.filter((row) => row.id !== id) }))
    },
    [patchSelected],
  )

  const addRow = useCallback(() => {
    patchSelected((prev) => ({ ...prev, rows: [...prev.rows, blankDraft()] }))
  }, [patchSelected])

  return {
    state: relPath ? (byPath[relPath] ?? EMPTY) : undefined,
    generate,
    confirmGenerate,
    cancelGenerate,
    updateRow,
    removeRow,
    addRow,
  }
}

/** Everything the model returns starts included — curating is opting *out*. */
function toDraft(task: ExtractedTask): TaskDraft {
  return { ...task, id: nextId(), include: true }
}

/**
 * A row the user is about to type. It has no evidence and nobody was mentioned,
 * because no transcript line backs it — the traceability block will say so.
 */
function blankDraft(): TaskDraft {
  const priority: Priority = 'none'
  return {
    id: nextId(),
    include: true,
    title: '',
    description: '',
    priority,
    mentioned: null,
    evidence: '',
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'No se pudieron generar las tareas.'
}
