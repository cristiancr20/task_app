import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { HttpError } from './api'
import { getConfig, updateConfig, type Config } from './store'

/** How many folders the recents list keeps, most recent first. */
export const MAX_RECENT_FOLDERS = 8

/**
 * Validate `input` as a context root and persist it, pushing it onto the
 * recents list.
 *
 * Throws when the folder cannot be opened — an `HttpError` for input that is
 * not a path at all, otherwise the raw `fs` error, so callers can turn either
 * into a message with `describeError`. Nothing is written when it throws: an
 * unusable folder never becomes the context root and never reaches the recents.
 */
export function openContextRoot(input: string): Config {
  const folder = normalizeFolder(input)
  assertReadableFolder(folder)

  const { recentFolders } = getConfig()
  return updateConfig({
    contextRoot: folder,
    recentFolders: withRecent(recentFolders, folder),
  })
}

/**
 * Trim, expand a leading `~`, and resolve — which also drops a trailing slash
 * and any `.`/`..` segment, so the stored root compares equal to the same
 * folder typed a second time in a slightly different shape.
 */
function normalizeFolder(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new HttpError(400, 'Escribe la ruta de la carpeta.')
  }

  const expanded =
    trimmed === '~' || trimmed.startsWith('~/')
      ? path.join(os.homedir(), trimmed.slice(1))
      : trimmed

  if (!path.isAbsolute(expanded)) {
    throw new HttpError(400, 'La ruta debe ser absoluta, empezando por «/».')
  }

  return path.resolve(expanded)
}

/**
 * `opendirSync` is the one call that covers every failure mode at once:
 * missing (ENOENT), not a folder (ENOTDIR) and not listable (EACCES). A
 * `statSync` would answer the first two but say nothing about readability.
 */
function assertReadableFolder(folder: string): void {
  const dir = fs.opendirSync(folder)
  dir.closeSync()
}

/** `folder` first, no duplicates, capped — reopening an old folder promotes it. */
function withRecent(recentFolders: string[], folder: string): string[] {
  return [folder, ...recentFolders.filter((it) => it !== folder)].slice(0, MAX_RECENT_FOLDERS)
}
