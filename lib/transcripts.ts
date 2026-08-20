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

/** Everything one recursive walk of the root produced. */
export type TranscriptWalk = {
  /** Every `.md` found, sorted like a listing: date descending, then title. */
  files: TranscriptMeta[]
  /** True when a limit stopped the walk before the whole tree was seen. */
  truncated: boolean
  /** Set when folders were left unvisited because they sat below `maxDepth`. */
  depthLimitReached: boolean
  /** Set when the walk stopped collecting because it reached `maxFiles`. */
  fileLimitReached: boolean
}

/** Limits for one walk; both default to the module constants below. */
export type WalkOptions = {
  maxDepth?: number
  maxFiles?: number
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

/**
 * How many folder levels below the root the walk descends. Deep enough for the
 * year / quarter / project nesting notes actually use, shallow enough that a
 * checkout or a mounted volume dropped inside the root cannot turn one request
 * into a full-disk scan. Folders deeper than this are not visited, and the
 * result says so.
 */
export const MAX_WALK_DEPTH = 8

/**
 * How many `.md` files one walk collects. What this feeds — the inbox and the
 * search index — is held in server memory, so the count is capped; reaching the
 * cap stops the walk and is reported instead of silently returning a short list.
 */
export const MAX_WALK_FILES = 5000

/**
 * Walk the whole root and return the metadata of every `.md` under it.
 *
 * Same exclusions as `listFolder` (dotfiles, `node_modules`, non-markdown) and
 * the same metadata, built by the same parser. What it adds is the part a
 * recursive walk needs and a single listing does not: it never follows a
 * symlink out of the root, it walks each real folder once so a symlinked cycle
 * cannot loop forever, it skips whatever it cannot read, and it stops at the
 * limits above rather than running away.
 */
export function walkTranscripts(root: string, options: WalkOptions = {}): TranscriptWalk {
  const maxDepth = options.maxDepth ?? MAX_WALK_DEPTH
  const maxFiles = options.maxFiles ?? MAX_WALK_FILES

  const rootAbs = realpath(path.resolve(root))
  const files: TranscriptMeta[] = []
  let depthLimitReached = false
  let fileLimitReached = false

  // Real paths of the folders already queued. A symlink that loops back to an
  // ancestor — or to any folder already seen — resolves to a path in here and
  // is dropped, which is what keeps a cycle from walking forever.
  const seen = new Set<string>([rootAbs])
  // Breadth first, so the shallow notes are the ones that survive `maxFiles`.
  // Every entry holds a real path, so the escape guard runs once per folder.
  const queue: Array<{ abs: string; rel: string; depth: number }> = [
    { abs: rootAbs, rel: '', depth: 0 },
  ]

  while (queue.length > 0 && !fileLimitReached) {
    const folder = queue.shift()!

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(folder.abs, { withFileTypes: true })
    } catch {
      // Unreadable folder (permissions, a volume that went away): skip this
      // branch instead of failing the walk.
      continue
    }

    for (const entry of entries) {
      const name = entry.name
      if (name.startsWith('.') || SKIPPED_DIRS.has(name)) continue

      const childRel = folder.rel ? `${folder.rel}/${name}` : name
      const childAbs = path.join(folder.abs, name)

      // `withFileTypes` describes the link itself, never its target, so a
      // symlink has to be resolved before it can be called a folder or a file.
      let real = childAbs
      let isDir = entry.isDirectory()
      let isFile = entry.isFile()

      if (entry.isSymbolicLink()) {
        real = realpath(childAbs)
        // Same guard as `resolveInsideRoot`: a link that lands outside the root
        // is not part of the tree, whatever it points at.
        if (!isInside(rootAbs, real)) continue

        let stats: fs.Stats
        try {
          stats = fs.statSync(childAbs)
        } catch {
          // Broken link, or one we may not follow.
          continue
        }
        isDir = stats.isDirectory()
        isFile = stats.isFile()
      } else if (isDir) {
        real = realpath(childAbs)
      }

      if (isDir) {
        if (folder.depth + 1 > maxDepth) {
          depthLimitReached = true
          continue
        }
        if (seen.has(real)) continue
        seen.add(real)
        queue.push({ abs: real, rel: childRel, depth: folder.depth + 1 })
        continue
      }

      if (!isFile || !isMarkdown(name)) continue

      if (files.length >= maxFiles) {
        fileLimitReached = true
        break
      }

      let raw: string
      try {
        raw = fs.readFileSync(childAbs, 'utf8')
      } catch {
        // Unreadable file: leave it out, exactly as `listFolder` does.
        continue
      }

      files.push(buildMeta(childRel, name, raw))
    }
  }

  files.sort(byDateDescThenTitle)

  return {
    files,
    truncated: depthLimitReached || fileLimitReached,
    depthLimitReached,
    fileLimitReached,
  }
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
