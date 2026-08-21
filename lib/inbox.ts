/**
 * The inbox: what is still unprocessed, as pure logic.
 *
 * «Sin procesar» is defined here and nowhere else, out of the two records the
 * app already keeps about a note — the push history in `config.json` and the
 * drafts in `drafts.json`. A note that was pushed has left the inbox for good;
 * a note with drafts is still in it, but it is not in the same place as one
 * nobody has opened, so it carries a status rather than being filtered out.
 *
 * Nothing here reads the filesystem or imports from `node:`: it takes the
 * metadata the walk produced and two lists of paths, and answers rows. That is
 * what lets the route build the inbox on the server and the browser import the
 * same types and labels.
 */

import { folderOfNote } from './note-paths'
import type { TranscriptMeta } from './transcripts'

/**
 * How far along a pending note is.
 *
 * `untouched` is a note nothing has ever been done to; `extracted` is one whose
 * tasks have already been pulled out and are waiting to be reviewed and sent.
 * Both are pending — the difference is what the next step is, which is why the
 * inbox shows it instead of merging them into one list.
 */
export type InboxStatus = 'untouched' | 'extracted'

/** One row of the inbox: the note, where it lives and how far along it is. */
export type InboxItem = {
  /** Path relative to the context root, `/`-separated — the key everything uses. */
  relPath: string
  fileName: string
  title: string
  /** `YYYY-MM-DD`, or null when the note says nothing about when it happened. */
  date: string | null
  /** The folder the note is in, `''` for one sitting at the root. */
  folder: string
  /** Words in the body, what the size of the note is shown from. */
  words: number
  /** ~4 characters per token, as the rest of the app estimates it. */
  approxTokens: number
  status: InboxStatus
}

export type InboxInput = {
  /** Every note under the root — the walk, straight from the index. */
  files: readonly TranscriptMeta[]
  /** Notes that have been pushed at least once. They are out of the inbox. */
  pushed: Iterable<string>
  /** Notes with drafts stored. They are in the inbox, as `extracted`. */
  drafted: Iterable<string>
}

/** How the inbox is split, for the header and for the empty state. */
export type InboxCounts = {
  total: number
  untouched: number
  extracted: number
}

/**
 * The pending notes, in the order the view shows them.
 *
 * A note is pending when it has never been pushed: the push is the act that
 * takes a transcript out of the inbox, and it is recorded per note in the
 * config. Whether it has drafts only decides the status — extracting is work
 * in progress, not a way out of the inbox.
 */
export function buildInbox({ files, pushed, drafted }: InboxInput): InboxItem[] {
  const done = new Set(pushed)
  const started = new Set(drafted)

  const items: InboxItem[] = []
  for (const file of files) {
    if (done.has(file.relPath)) continue

    items.push({
      relPath: file.relPath,
      fileName: file.fileName,
      title: file.title,
      date: file.date,
      folder: folderOfNote(file.relPath),
      words: file.words,
      approxTokens: file.approxTokens,
      status: started.has(file.relPath) ? 'extracted' : 'untouched',
    })
  }

  // Sorted here rather than trusted from the walk: the order is part of what
  // the inbox promises («lo más reciente primero, lo sin fecha al final») and
  // it is the same list whatever produced the metadata.
  return items.sort(byDateDescThenTitle)
}

/** How many are pending, and how many of those are already extracted. */
export function inboxCounts(items: readonly InboxItem[]): InboxCounts {
  const extracted = items.filter((item) => item.status === 'extracted').length
  return { total: items.length, untouched: items.length - extracted, extracted }
}

/**
 * Most recent first; a note with no date goes last, whatever the other one is.
 *
 * An undated note is «no consta», not «hace mucho»: sorting it as an empty
 * string would bury it under every dated note as though it were the oldest
 * thing in the folder, when in fact it is the one the app knows least about.
 * Same date, or both undated, falls back to the title so the order is stable.
 */
export function byDateDescThenTitle(a: InboxItem, b: InboxItem): number {
  if (a.date !== b.date) {
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  }
  return a.title.localeCompare(b.title)
}

/**
 * How big a note is, in words, written for a row: `840 palabras`,
 * `1,2k palabras`, `18k palabras`.
 *
 * Words rather than bytes because it is the size that matters here — how much
 * there is to read, and how much an extraction is going to have to chew — and
 * because it is the number the metadata already carries. Above a thousand the
 * exact figure says nothing a rounded one does not, so it is abbreviated and
 * the row stays one line.
 */
export function noteSizeLabel(words: number): string {
  if (!Number.isFinite(words) || words <= 0) return 'sin texto'

  const exact = Math.round(words)
  if (exact === 1) return '1 palabra'
  if (exact < 1000) return `${exact} palabras`

  const thousands = exact / 1000
  // One decimal up to 10k, where it still distinguishes notes; none above it,
  // where `23,4k` is precision nobody is going to act on.
  const rounded =
    thousands < 10 ? (Math.round(thousands * 10) / 10).toFixed(1).replace('.', ',') : String(Math.round(thousands))

  return `${rounded}k palabras`
}
