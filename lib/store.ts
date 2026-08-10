import fs from 'node:fs'
import path from 'node:path'

import { dataFile } from './data-dir'

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
    ollamaModel: 'qwen3:8b',
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
 * Write the config atomically: a temp file in the same folder followed by a
 * rename, which is atomic on the same filesystem. A crash mid-write leaves the
 * previous config intact instead of a truncated JSON file.
 */
function writeConfig(config: Config): void {
  const target = dataFile(CONFIG_FILE)
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${tmpCounter++}.tmp`,
  )

  try {
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
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
