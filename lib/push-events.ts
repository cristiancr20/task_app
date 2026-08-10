/**
 * The wire contract of `POST /api/linear/push`: what the browser sends and the
 * events it reads back while the run is in progress.
 *
 * It lives on its own, apart from `lib/linear-push.ts`, because both sides need
 * its *values* (`PARENT_ROW_ID`, the event guard) and not just its types — and
 * the run itself reaches the API key and the store, which must never be pulled
 * into the client bundle. Nothing here imports anything that is not a type.
 */

import type { Priority } from './extractors/task'

/**
 * The id the parent issue reports its progress under. Table rows are keyed
 * `row-N`, so it cannot collide with one — the parent is a step of the run with
 * no row of its own, and the panel is what renders it.
 */
export const PARENT_ROW_ID = '__parent__'

/** One task of the push. `id` is the table row it belongs to, echoed back in every event. */
export type PushTaskInput = {
  id: string
  title: string
  description: string
  priority: Priority
  mentioned: string | null
  evidence: string
}

/** The body of `POST /api/linear/push`. */
export type PushRequest = {
  /** The transcript the tasks came from, root-relative — the traceability block is built from it. */
  path: string
  teamId: string
  /** `null` files the issues in the team's backlog. */
  projectId: string | null
  /** Title of the parent issue to create first, or `null` for no parent. */
  parentTitle: string | null
  /**
   * A parent created by an earlier run. A retry hangs its tasks from the same
   * parent instead of creating a second one for the same meeting.
   */
  parentId: string | null
  tasks: PushTaskInput[]
}

/** A created issue, as the UI links to it and the history stores it. */
export type PushedIssue = {
  id: string
  identifier: string
  url: string
  title: string
}

/**
 * One line of the NDJSON stream. Issues are created one at a time, so the
 * events arrive in the order the run went through them: `start`, then
 * `creating`/`created`|`failed` per issue, then `done` — with `aborted` in
 * front of `done` when the run gave up early.
 */
export type PushEvent =
  /** How many issues the run is going to attempt, parent included. */
  | { type: 'start'; total: number }
  /** `index` is 1-based, so it reads «Creando 2 de 5». */
  | { type: 'creating'; id: string; index: number; total: number; title: string }
  | { type: 'created'; id: string; issue: PushedIssue }
  | { type: 'failed'; id: string; title: string; error: string }
  /** The run stopped before attempting every task; the rest stay pending. */
  | { type: 'aborted'; error: string }
  | { type: 'done'; created: number; failed: number }

const EVENT_TYPES = ['start', 'creating', 'created', 'failed', 'aborted', 'done'] as const

/**
 * Whether a parsed line is an event we know. The stream comes from our own
 * route, so this is not validation of untrusted data — it is what keeps a
 * version mismatch (a newer route, a cached client) from being applied as a
 * half-understood event instead of being reported.
 */
export function isPushEvent(value: unknown): value is PushEvent {
  if (typeof value !== 'object' || value === null) return false
  const { type } = value as { type?: unknown }
  return typeof type === 'string' && (EVENT_TYPES as readonly string[]).includes(type)
}
