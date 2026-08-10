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
  /** An extraction is in flight for this file. */
  generating: boolean
  /** Message of the last failed extraction. The rows are left untouched. */
  error: string | null
  /** An extraction finished, so «ninguna tarea» means the model found none. */
  extracted: boolean
}

const EMPTY: TaskDraftState = { rows: [], generating: false, error: null, extracted: false }

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
  generate: () => void
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

  const generate = useCallback(() => {
    if (!relPath) return
    patch(relPath, (prev) => ({ ...prev, generating: true, error: null }))

    // The answer is written under the path it was asked for, so a slow
    // extraction never lands on the file the user has moved on to.
    extractTasks(relPath).then(
      (tasks) =>
        patch(relPath, () => ({
          rows: tasks.map(toDraft),
          generating: false,
          error: null,
          extracted: true,
        })),
      // The previous table survives a failure: the message says what went
      // wrong, and rows the user already edited are not collateral damage.
      (err: unknown) =>
        patch(relPath, (prev) => ({ ...prev, generating: false, error: errorMessage(err) })),
    )
  }, [patch, relPath])

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
