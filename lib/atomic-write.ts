import fs from 'node:fs'
import path from 'node:path'

/** Owner-only: everything under `.data/` is the user's private local state. */
export const FILE_MODE = 0o600

/** Distinguishes temp files of writes issued back to back within one process. */
let tmpCounter = 0

/**
 * Write `value` as pretty JSON to `target`, atomically and owner-only.
 *
 * Atomically means a temp file in the same folder followed by a rename, which
 * is atomic on the same filesystem. A crash mid-write leaves the previous
 * contents intact instead of a truncated JSON file.
 *
 * The temp file is created — and then explicitly chmod'ed — as `0600`, so a
 * file holding API keys is never world-readable, not even for the instant
 * between write and rename. `rename` keeps the mode of the temp file, so this
 * is also what fixes a file that an older version left with laxer permissions;
 * chmod'ing the target afterwards instead would reopen exactly the window this
 * avoids. The explicit chmod matters because `writeFileSync`'s `mode` only
 * applies when it creates the file, and is masked by the process umask when it
 * does.
 */
export function writeJsonFile(target: string, value: unknown): void {
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${tmpCounter++}.tmp`,
  )

  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: FILE_MODE,
    })
    fs.chmodSync(tmp, FILE_MODE)
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
