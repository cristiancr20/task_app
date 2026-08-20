import fs from 'node:fs'

import { writeJsonFile } from './atomic-write'
import { dataFile } from './data-dir'
import { DEFAULT_OLLAMA_MODEL } from './ollama'

export type Provider = 'ollama' | 'claude'

/** A Linear issue as it was created, kept so the UI can link back to it. */
export type HistoryIssue = {
  id: string
  identifier: string
  url: string
  title: string
}

/** One push of a transcript to Linear. */
export type HistoryEntry = {
  pushedAt: string
  issues: HistoryIssue[]
  /**
   * Where the push went. `null` is «no consta» and not «ninguno»: an entry
   * written before this was recorded reads that way, so a filter by project
   * has to treat it as unknown rather than as belonging to no project.
   */
  teamId: string | null
  projectId: string | null
}

/**
 * The history of one note condensed to what a row of the file list can show:
 * how much it produced and when it last did.
 */
export type PushSummary = {
  /** Issues created from the note across every push. */
  issues: number
  /** How many times it was pushed. */
  pushes: number
  /** Timestamp of the most recent push. */
  lastPushedAt: string
}

export type Config = {
  recentFolders: string[]
  contextRoot: string | null
  provider: Provider
  ollamaModel: string
  claudeApiKey: string
  linearApiKey: string
  lastProjectId: string | null
  /** Push history keyed by the transcript path relative to `contextRoot`. */
  history: Record<string, HistoryEntry[]>
}

const CONFIG_FILE = 'config.json'

export function defaultConfig(): Config {
  return {
    recentFolders: [],
    contextRoot: null,
    provider: 'ollama',
    ollamaModel: DEFAULT_OLLAMA_MODEL,
    claudeApiKey: '',
    linearApiKey: '',
    lastProjectId: null,
    history: {},
  }
}

/**
 * Read `.data/config.json`. A missing, unreadable, malformed or partially
 * corrupt file yields defaults rather than throwing — the config is local
 * state the user can always re-enter, never a reason to break a request.
 */
export function getConfig(): Config {
  let raw: string
  try {
    raw = fs.readFileSync(dataFile(CONFIG_FILE), 'utf8')
  } catch {
    return defaultConfig()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultConfig()
  }

  return normalize(parsed)
}

/** Merge `partial` over the stored config and persist it. Returns the result. */
export function updateConfig(partial: Partial<Config>): Config {
  const next = normalize({ ...getConfig(), ...partial })
  writeConfig(next)
  return next
}

/**
 * What a caller has to hand over to record a push. The destination is optional
 * because it is a later addition: a caller that does not track it writes the
 * same call it always wrote and `normalizeEntry` stores `null`, exactly as it
 * does for an entry saved before the fields existed.
 */
export type HistoryEntryInput = Omit<HistoryEntry, 'teamId' | 'projectId'> &
  Partial<Pick<HistoryEntry, 'teamId' | 'projectId'>>

/** Append one push entry to the history of `relPath`, most recent last. */
export function addHistoryEntry(relPath: string, entry: HistoryEntryInput): Config {
  const config = getConfig()
  const entries = config.history[relPath] ?? []
  const normalized = normalizeEntry(entry)
  config.history[relPath] = normalized ? [...entries, normalized] : entries
  writeConfig(config)
  return config
}

/** Push history for `relPath`, oldest first. Empty when the file was never pushed. */
export function getHistory(relPath: string): HistoryEntry[] {
  return getConfig().history[relPath] ?? []
}

/**
 * One summary per note that has ever been pushed, keyed by the same
 * root-relative path the history uses. Notes that were never pushed are absent
 * rather than present with zeros, so a lookup answers the badge's question —
 * «did this one already produce tasks?» — on its own.
 */
export function getPushSummaries(): Record<string, PushSummary> {
  const summaries: Record<string, PushSummary> = {}
  for (const [relPath, entries] of Object.entries(getConfig().history)) {
    const summary = summarize(entries)
    if (summary) summaries[relPath] = summary
  }
  return summaries
}

/** Entries are stored oldest first, so the last one is the most recent push. */
function summarize(entries: HistoryEntry[]): PushSummary | null {
  const issues = entries.reduce((count, entry) => count + entry.issues.length, 0)
  if (issues === 0) return null

  return {
    issues,
    pushes: entries.length,
    lastPushedAt: entries[entries.length - 1].pushedAt,
  }
}

/**
 * Persist the config. The write is atomic and owner-only (`lib/atomic-write`),
 * because this file holds the Claude and Linear API keys: a crash mid-write
 * must not cost the user their keys, and no other account on the machine
 * should be able to read them.
 */
function writeConfig(config: Config): void {
  writeJsonFile(dataFile(CONFIG_FILE), config)
}

/** Coerce arbitrary parsed JSON into a complete, well-typed `Config`. */
function normalize(input: unknown): Config {
  const defaults = defaultConfig()
  if (!isRecord(input)) return defaults

  return {
    recentFolders: stringArray(input.recentFolders),
    contextRoot: nullableString(input.contextRoot),
    provider: input.provider === 'claude' ? 'claude' : defaults.provider,
    ollamaModel: typeof input.ollamaModel === 'string' ? input.ollamaModel : defaults.ollamaModel,
    claudeApiKey: typeof input.claudeApiKey === 'string' ? input.claudeApiKey : '',
    linearApiKey: typeof input.linearApiKey === 'string' ? input.linearApiKey : '',
    lastProjectId: nullableString(input.lastProjectId),
    history: normalizeHistory(input.history),
  }
}

function normalizeHistory(input: unknown): Record<string, HistoryEntry[]> {
  if (!isRecord(input)) return {}

  const history: Record<string, HistoryEntry[]> = {}
  for (const [relPath, value] of Object.entries(input)) {
    if (!Array.isArray(value)) continue
    const entries = value
      .map(normalizeEntry)
      .filter((entry): entry is HistoryEntry => entry !== null)
    if (entries.length > 0) history[relPath] = entries
  }
  return history
}

/**
 * `pushedAt` and `issues` are what an entry *is*, so a record missing either is
 * dropped. The destination is not: an entry written before US-006 has neither
 * field, and discarding it would throw away the history the user already has.
 * A value of the wrong type reads the same as an absent one — `null`.
 */
function normalizeEntry(input: unknown): HistoryEntry | null {
  if (!isRecord(input)) return null
  if (typeof input.pushedAt !== 'string') return null
  if (!Array.isArray(input.issues)) return null

  return {
    pushedAt: input.pushedAt,
    issues: input.issues
      .map(normalizeIssue)
      .filter((issue): issue is HistoryIssue => issue !== null),
    teamId: nullableString(input.teamId),
    projectId: nullableString(input.projectId),
  }
}

function normalizeIssue(input: unknown): HistoryIssue | null {
  if (!isRecord(input)) return null
  const { id, identifier, url, title } = input
  if (
    typeof id !== 'string' ||
    typeof identifier !== 'string' ||
    typeof url !== 'string' ||
    typeof title !== 'string'
  ) {
    return null
  }
  return { id, identifier, url, title }
}

function stringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((it): it is string => typeof it === 'string') : []
}

function nullableString(input: unknown): string | null {
  return typeof input === 'string' ? input : null
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
