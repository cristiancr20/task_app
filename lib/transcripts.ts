import fs from 'node:fs'
import path from 'node:path'

import { parse as parseYaml } from 'yaml'

/** A folder directly under the folder that was listed. */
export type FolderEntry = {
  /** Folder name as it appears on disk. */
  name: string
  /** Path relative to the root, `/`-separated. */
  relPath: string
}

/** Everything the explorer needs to render one `.md` file without opening it. */
export type TranscriptMeta = {
  /** Path relative to the root, `/`-separated. */
  relPath: string
  fileName: string
  title: string
  /** `YYYY-MM-DD`, from frontmatter or the filename; null when unknown. */
  date: string | null
  attendees: string[]
  words: number
  approxTokens: number
  hasFrontmatter: boolean
}

export type FolderListing = {
  /** Path of the listed folder relative to the root, `/`-separated (`''` = root). */
  relPath: string
  folders: FolderEntry[]
  files: TranscriptMeta[]
}

export type Transcript = {
  meta: TranscriptMeta
  /** File contents with the frontmatter block removed. */
  body: string
}

/**
 * Thrown when a requested path resolves outside the root. Its own type so
 * callers (the API routes) can answer 400 instead of 500 without matching
 * on the message.
 */
export class PathEscapesRootError extends Error {
  constructor(relPath: string) {
    super(`Path escapes the root folder: ${relPath}`)
    this.name = 'PathEscapesRootError'
  }
}

/** Folders that are never worth walking into, whatever the root is. */
const SKIPPED_DIRS = new Set(['node_modules'])

/** `2026-08-09` at the start of a filename, the convention for dated notes. */
const LEADING_DATE = /^(\d{4}-\d{2}-\d{2})/

/** An opening `---` line, then the YAML block, then a closing `---` line. */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * Resolve `relPath` against `root` and refuse anything that lands outside it.
 *
 * `relPath` comes from the browser, so it may be absolute, contain `..`, or
 * point at a symlink aiming elsewhere. All three escape the root and all three
 * throw here — this is the only place that turns request input into a path.
 */
export function resolveInsideRoot(root: string, relPath: string): string {
  const rootAbs = realpath(path.resolve(root))
  const resolved = path.resolve(rootAbs, normalizeRelPath(relPath))

  if (!isInside(rootAbs, resolved)) {
    throw new PathEscapesRootError(relPath)
  }

  // A symlink inside the root can still point outside it, so re-check the
  // resolved target. Non-existent paths have no real path; the lexical check
  // above is all they get (callers surface the ENOENT themselves).
  const real = realpath(resolved)
  if (!isInside(rootAbs, real)) {
    throw new PathEscapesRootError(relPath)
  }

  return resolved
}

/**
 * List one folder level: its subfolders and its `.md` files, never recursing.
 * Dotfiles and `node_modules` are skipped, as are files that cannot be read.
 * Files come back sorted by date descending, then by title.
 */
export function listFolder(root: string, relPath: string): FolderListing {
  const base = normalizeRelPath(relPath)
  const abs = resolveInsideRoot(root, base)

  const folders: FolderEntry[] = []
  const files: TranscriptMeta[] = []

  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const name = entry.name
    if (name.startsWith('.') || SKIPPED_DIRS.has(name)) continue

    const childRel = base ? `${base}/${name}` : name

    if (entry.isDirectory()) {
      folders.push({ name, relPath: childRel })
      continue
    }

    if (!entry.isFile() || !isMarkdown(name)) continue

    let raw: string
    try {
      raw = fs.readFileSync(path.join(abs, name), 'utf8')
    } catch {
      // Unreadable file (permissions, a broken symlink): leave it out of the
      // listing rather than failing the whole folder.
      continue
    }

    files.push(buildMeta(childRel, name, raw))
  }

  folders.sort((a, b) => a.name.localeCompare(b.name))
  files.sort(byDateDescThenTitle)

  return { relPath: base, folders, files }
}

/** Read one `.md` file: its metadata plus the body with frontmatter stripped. */
export function readTranscript(root: string, relPath: string): Transcript {
  const rel = normalizeRelPath(relPath)
  const abs = resolveInsideRoot(root, rel)
  const raw = fs.readFileSync(abs, 'utf8')
  const fileName = path.basename(rel)

  return { meta: buildMeta(rel, fileName, raw), body: splitFrontmatter(raw).body }
}

/** Derive every metadata field from a file's raw contents. */
function buildMeta(relPath: string, fileName: string, raw: string): TranscriptMeta {
  const { data, body, hasFrontmatter } = splitFrontmatter(raw)
  const words = countWords(body)

  return {
    relPath,
    fileName,
    title: firstString(data.title) ?? titleFromFileName(fileName),
    date: toIsoDate(data.date) ?? dateFromFileName(fileName),
    attendees: toStringList(data.attendees),
    words,
    approxTokens: approxTokens(body),
    hasFrontmatter,
  }
}

/**
 * Split a leading `---` YAML block off the body.
 *
 * Malformed YAML is not an error: the file is simply treated as having no
 * frontmatter, so a half-written note still shows up in the explorer.
 */
function splitFrontmatter(raw: string): {
  data: Record<string, unknown>
  body: string
  hasFrontmatter: boolean
} {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const match = FRONTMATTER.exec(text)
  if (!match) return { data: {}, body: text, hasFrontmatter: false }

  let parsed: unknown
  try {
    parsed = parseYaml(match[1])
  } catch {
    return { data: {}, body: text, hasFrontmatter: false }
  }

  // Scalars and sequences are valid YAML but carry no named fields, so they
  // are no more useful than plain text.
  if (!isRecord(parsed)) return { data: {}, body: text, hasFrontmatter: false }

  return { data: parsed, body: text.slice(match[0].length), hasFrontmatter: true }
}

/** `2026-08-09 Weekly sync.md` → `Weekly sync`. */
export function titleFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.md$/i, '')
  const withoutDate = stem.replace(/^\d{4}-\d{2}-\d{2}[ _-]*/, '')
  const cleaned = (withoutDate || stem).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || stem
}

function dateFromFileName(fileName: string): string | null {
  return LEADING_DATE.exec(fileName)?.[1] ?? null
}

/**
 * Accept what a hand-written frontmatter realistically holds: `2026-08-09`,
 * a full ISO timestamp, or a value the YAML schema turned into a Date.
 */
function toIsoDate(input: unknown): string | null {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input.toISOString().slice(0, 10)
  }
  if (typeof input !== 'string') return null

  const match = /^\s*(\d{4}-\d{2}-\d{2})/.exec(input)
  return match ? match[1] : null
}

/** Attendees may be a YAML list or a single comma-separated line. */
function toStringList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map(scalarToString).filter((it): it is string => it !== null)
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((it) => it.trim())
      .filter((it) => it.length > 0)
  }
  return []
}

function scalarToString(input: unknown): string | null {
  if (typeof input === 'string') return input.trim() || null
  if (typeof input === 'number' || typeof input === 'boolean') return String(input)
  return null
}

function firstString(input: unknown): string | null {
  return typeof input === 'string' && input.trim() ? input.trim() : null
}

function countWords(body: string): number {
  const trimmed = body.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/** ~4 characters per token: close enough to size a context window against. */
function approxTokens(body: string): number {
  return Math.ceil(body.trim().length / 4)
}

function byDateDescThenTitle(a: TranscriptMeta, b: TranscriptMeta): number {
  if (a.date !== b.date) {
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  }
  return a.title.localeCompare(b.title)
}

function isMarkdown(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.md')
}

/**
 * `''`, `'.'` and `'/'` all mean the root; the result is `/`-separated.
 *
 * Leading slashes are stripped, so a URL-style `/sub/notes.md` is read as
 * root-relative rather than as `/sub/notes.md` on the host filesystem — an
 * absolute path therefore misses (ENOENT) instead of reaching outside the root.
 */
export function normalizeRelPath(relPath: string): string {
  const trimmed = (relPath ?? '').trim()
  if (!trimmed || trimmed === '.' || trimmed === '/') return ''
  return trimmed.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

function isInside(rootAbs: string, target: string): boolean {
  return target === rootAbs || target.startsWith(rootAbs + path.sep)
}

/** Real path when it exists, the input untouched when it does not. */
function realpath(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
