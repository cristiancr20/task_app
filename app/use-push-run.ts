'use client'

import { useCallback, useState } from 'react'

import { pushTasks } from '@/lib/push-client'
import { PARENT_ROW_ID, type PushEvent, type PushRequest, type PushedIssue } from '@/lib/push-events'

/**
 * How one row of the table ended up. A row with no result at all is *pending*:
 * either the run has not reached it, or it stopped before doing so.
 */
export type PushRowResult =
  | { state: 'creating' }
  | { state: 'created'; issue: PushedIssue }
  | { state: 'failed'; error: string }

export type PushRunState = {
  status: 'idle' | 'running' | 'finished'
  /** Results by row id, with the parent under `PARENT_ROW_ID`. */
  rows: Record<string, PushRowResult>
  /** What the run is on right now, for «Creando 2 de 5». Null when it is not running. */
  progress: { index: number; total: number } | null
  /** Why the run stopped early, or why it never started. */
  error: string | null
}

const EMPTY: PushRunState = { status: 'idle', rows: {}, progress: null, error: null }

/** What the caller supplies: the plan, minus the path this hook already knows. */
export type PushPlanInput = Omit<PushRequest, 'path'>

/**
 * The push of every transcript visited since the page loaded.
 *
 * Keyed by path like the drafts and the parent options: the panel is not
 * unmounted when the selection changes, so a plain `useState` would show one
 * meeting's results — and offer to retry its failures — while another note is
 * on screen. Nothing here is persisted; US-019 is what writes the created
 * issues to the history.
 */
export function usePushRun(relPath: string | null): {
  state: PushRunState
  /** Starts the run. Rows already created keep their result and are not re-sent. */
  push: (plan: PushPlanInput) => void
} {
  const [byPath, setByPath] = useState<Record<string, PushRunState>>({})

  const patch = useCallback(
    (path: string, change: (previous: PushRunState) => PushRunState) => {
      setByPath((previous) => ({ ...previous, [path]: change(previous[path] ?? EMPTY) }))
    },
    [],
  )

  const push = useCallback(
    (plan: PushPlanInput) => {
      if (!relPath) return
      const path = relPath

      // A retry forgets the previous failures — they are about to be attempted
      // again — but never what was created, which is how a created row stays
      // out of the next request.
      patch(path, (previous) => ({
        status: 'running',
        rows: onlyCreated(previous.rows),
        progress: null,
        error: null,
      }))

      // Every event is written under the path it was asked for, so a slow run
      // never lands on the note the user has moved on to.
      pushTasks({ path, ...plan }, (event) => patch(path, (previous) => apply(previous, event))).then(
        () => patch(path, settle),
        (err: unknown) =>
          patch(path, (previous) => ({ ...settle(previous), error: errorMessage(err) })),
      )
    },
    [patch, relPath],
  )

  return { state: (relPath ? byPath[relPath] : undefined) ?? EMPTY, push }
}

/** Fold one streamed event into the state. */
function apply(state: PushRunState, event: PushEvent): PushRunState {
  switch (event.type) {
    case 'start':
      return { ...state, progress: { index: 0, total: event.total } }
    case 'creating':
      return {
        ...state,
        progress: { index: event.index, total: event.total },
        rows: { ...state.rows, [event.id]: { state: 'creating' } },
      }
    case 'created':
      return {
        ...state,
        rows: { ...state.rows, [event.id]: { state: 'created', issue: event.issue } },
      }
    case 'failed':
      return {
        ...state,
        rows: { ...state.rows, [event.id]: { state: 'failed', error: event.error } },
      }
    case 'aborted':
      return { ...state, error: event.error }
    case 'done':
      return { ...state, progress: null }
  }
}

/**
 * The run is over. A row left mid-flight means the stream ended while an issue
 * was being created — the connection dropped, or the server did — and the
 * honest thing to say is that we do not know whether it landed, because a
 * blind retry would create it twice.
 */
function settle(state: PushRunState): PushRunState {
  const rows: Record<string, PushRowResult> = {}
  for (const [id, result] of Object.entries(state.rows)) {
    rows[id] =
      result.state === 'creating'
        ? {
            state: 'failed',
            error: 'Se interrumpió el envío: comprueba en Linear si la tarea se creó.',
          }
        : result
  }
  return { ...state, status: 'finished', progress: null, rows }
}

/** What survives a retry: the issues that already exist in Linear. */
function onlyCreated(rows: Record<string, PushRowResult>): Record<string, PushRowResult> {
  const kept: Record<string, PushRowResult> = {}
  for (const [id, result] of Object.entries(rows)) {
    if (result.state === 'created') kept[id] = result
  }
  return kept
}

/** The parent created by this run, when there is one — a retry reuses it. */
export function parentIssueOf(state: PushRunState): PushedIssue | null {
  const parent = state.rows[PARENT_ROW_ID]
  return parent?.state === 'created' ? parent.issue : null
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'No se pudieron crear las tareas en Linear.'
}
