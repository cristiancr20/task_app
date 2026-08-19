import fs from 'node:fs'
import path from 'node:path'

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

/** Distinguishes temp files of writes issued back to back within one process. */
let tmpCounter = 0

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

/** Append one push entry to the history of `relPath`, most recent last. */
export function addHistoryEntry(relPath: string, entry: HistoryEntry): Config {
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

/** Owner-only, because the config holds the Claude and Linear API keys. */
const CONFIG_MODE = 0o600

/**
 * Write the config atomically: a temp file in the same folder followed by a
 * rename, which is atomic on the same filesystem. A crash mid-write leaves the
 * previous config intact instead of a truncated JSON file.
 *
 * The temp file is created — and then explicitly chmod'ed — as `0600`, so the
 * keys are never world-readable, not even for the instant between write and
 * rename. `rename` keeps the mode of the temp file, so this is also what fixes
 * a `config.json` that an older version left with laxer permissions; chmod'ing
 * the target afterwards instead would reopen exactly the window this avoids.
 * The explicit chmod matters because `writeFileSync`'s `mode` only applies when
 * it creates the file, and is masked by the process umask when it does.
 */
function writeConfig(config: Config): void {
  const target = dataFile(CONFIG_FILE)
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${tmpCounter++}.tmp`,
  )

  try {
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode: CONFIG_MODE,
    })
    fs.chmodSync(tmp, CONFIG_MODE)
    fs.renameSync(tmp, target)
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // The temp file is already gone or unremovable; the original error matters more.
    }
    throw err
  }
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

function normalizeEntry(input: unknown): HistoryEntry | null {
  if (!isRecord(input)) return null
  if (typeof input.pushedAt !== 'string') return null
  if (!Array.isArray(input.issues)) return null

  return {
    pushedAt: input.pushedAt,
    issues: input.issues
      .map(normalizeIssue)
      .filter((issue): issue is HistoryIssue => issue !== null),
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
