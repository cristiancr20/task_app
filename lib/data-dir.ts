import fs from 'node:fs'
import path from 'node:path'

/**
 * Local, git-ignored folder holding app state (config + push history).
 * Kept next to the project root so the app is self-contained per checkout.
 */
export const DATA_DIR = path.join(process.cwd(), '.data')

/** Resolve a file inside `.data/`, creating the folder if it is missing. */
export function dataFile(fileName: string): string {
  ensureDataDir()
  return path.join(DATA_DIR, fileName)
}

/**
 * Create `.data/` if it does not exist yet. Safe to call repeatedly.
 *
 * `0o700` because the folder holds the user's API keys: on a shared machine no
 * other account should be able to list it, let alone read what is inside.
 */
export function ensureDataDir(): string {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  return DATA_DIR
}
