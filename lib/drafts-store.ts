/**
 * Where the task table's drafts live between reloads.
 *
 * `lib/store.ts` keeps the config and the push history; this keeps the work in
 * progress that precedes a push — the rows the user is still curating, note by
 * note. Same folder, same atomic owner-only write, same rule that a corrupt
 * file yields empty state instead of throwing: losing drafts is annoying,
 * refusing to open the app over them would be worse.
 *
 * It is a separate file from `config.json` because it churns on every edit and
 * can grow with the number of notes, while the config is small and rarely
 * written — a corrupt `drafts.json` must never be able to cost the user their
 * API keys.
 */

import fs from 'node:fs'

import { writeJsonFile } from './atomic-write'
import { dataFile } from './data-dir'
import { PRIORITIES, type ExtractedTask, type Priority } from './extractors/task'

/**
 * One row of the table as it is stored: the extracted task plus the two things
 * only the table knows — its key and whether it is going to Linear. Mirrors
 * `TaskDraft` in `app/use-task-drafts.ts`, which is what the browser sends.
 */
export type DraftRow = ExtractedTask & {
  id: string
  include: boolean
}

/**
 * The drafts of one note. Deliberately *not* the whole `TaskDraftState`: the
 * transient fields of that state (`generating`, `error`, `confirming`) describe
 * a request in flight or a dialog on screen, and restoring them from disk would
 * resurrect a spinner for an extraction that is long over.
 */
export type DraftsState = {
  rows: DraftRow[]
  /** The rows as the last extraction returned them, for the change count. */
  baseline: DraftRow[]
  /** An extraction finished, so «ninguna tarea» means the model found none. */
  extracted: boolean
}

const DRAFTS_FILE = 'drafts.json'

/** What a note with nothing stored looks like. A fresh object every call. */
export function emptyDrafts(): DraftsState {
  return { rows: [], baseline: [], extracted: false }
}

/**
 * The stored drafts of `relPath`, keyed the way the history is: by the path of
 * the note relative to the context root. Empty for a note that was never
 * curated, and equally empty when the file is missing, unreadable or corrupt.
 */
export function getDrafts(relPath: string): DraftsState {
  return readAll()[relPath] ?? emptyDrafts()
}

/**
 * Persist the drafts of `relPath`, replacing whatever was stored for it and
 * leaving the other notes alone. Returns what was actually written, which is
 * the normalised `state`.
 *
 * A state with nothing in it drops the key instead of storing an empty record,
 * so the file only ever holds notes that have something to restore.
 */
export function saveDrafts(relPath: string, state: DraftsState): DraftsState {
  const drafts = readAll()
  const next = normalizeState(state)

  if (isEmpty(next)) delete drafts[relPath]
  else drafts[relPath] = next

  writeDrafts(drafts)
  return next
}

/** Forget the drafts of `relPath`. A note that had none is not an error. */
export function clearDrafts(relPath: string): void {
  const drafts = readAll()
  if (!(relPath in drafts)) return

  delete drafts[relPath]
  writeDrafts(drafts)
}

/**
 * Coerce arbitrary input — a parsed request body, say — into a `DraftsState`.
 * The route hands the result to `saveDrafts` so that what the browser sends
 * goes through exactly the same sieve as what is already on disk.
 */
export function normalizeState(input: unknown): DraftsState {
  if (!isRecord(input)) return emptyDrafts()

  return {
    rows: normalizeRows(input.rows),
    baseline: normalizeRows(input.baseline),
    extracted: input.extracted === true,
  }
}

/** Nothing worth restoring: no rows, no baseline, and no extraction behind them. */
function isEmpty(state: DraftsState): boolean {
  return state.rows.length === 0 && state.baseline.length === 0 && !state.extracted
}

/**
 * Read `.data/drafts.json`. A missing, unreadable, malformed or partially
 * corrupt file yields no drafts rather than throwing — the same reasoning as
 * `getConfig`, and the same consequence: the note simply starts empty.
 */
function readAll(): Record<string, DraftsState> {
  let raw: string
  try {
    raw = fs.readFileSync(dataFile(DRAFTS_FILE), 'utf8')
  } catch {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }

  return normalizeAll(parsed)
}

/** Atomic and `0600`, like the config — see `lib/atomic-write`. */
function writeDrafts(drafts: Record<string, DraftsState>): void {
  writeJsonFile(dataFile(DRAFTS_FILE), { drafts })
}

function normalizeAll(input: unknown): Record<string, DraftsState> {
  if (!isRecord(input) || !isRecord(input.drafts)) return {}

  const drafts: Record<string, DraftsState> = {}
  for (const [relPath, value] of Object.entries(input.drafts)) {
    const state = normalizeState(value)
    if (!isEmpty(state)) drafts[relPath] = state
  }
  return drafts
}

function normalizeRows(input: unknown): DraftRow[] {
  if (!Array.isArray(input)) return []
  return input.map(normalizeRow).filter((row): row is DraftRow => row !== null)
}

/**
 * One stored row, or null when it carries no `id` — the key the table edits
 * rows by. A row without one cannot be edited or removed, so restoring it
 * would put something on screen the user could not get rid of.
 *
 * Every other field is coerced rather than required: an empty title is a row
 * the user was still typing, not a broken one, and text is stored verbatim
 * because trimming it would move the caret of a draft mid-edit.
 */
function normalizeRow(input: unknown): DraftRow | null {
  if (!isRecord(input)) return null
  if (typeof input.id !== 'string' || !input.id) return null

  return {
    id: input.id,
    title: text(input.title),
    description: text(input.description),
    priority: normalizePriority(input.priority),
    mentioned: typeof input.mentioned === 'string' ? input.mentioned : null,
    evidence: text(input.evidence),
    // Everything the model returns starts included — curating is opting *out*,
    // so a missing flag restores the row rather than silently dropping it.
    include: typeof input.include === 'boolean' ? input.include : true,
  }
}

/** Anything outside Linear's scale — including a number or `null` — is `none`. */
function normalizePriority(value: unknown): Priority {
  return (PRIORITIES as readonly unknown[]).includes(value) ? (value as Priority) : 'none'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
