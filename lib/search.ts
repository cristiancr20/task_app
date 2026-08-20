/**
 * Full-text search over the transcripts, as pure logic.
 *
 * Everything here is arithmetic over strings: nothing reads the filesystem,
 * the network or `process.env`, and nothing is imported from `node:`. The
 * route feeds it one note at a time and the browser is free to import the
 * types and the limits from the same module, so both sides agree on what a
 * match is.
 *
 * The one design decision worth stating up front: a match is located in the
 * *normalised* text — lowercase, without diacritics, whitespace collapsed —
 * but the excerpt is cut out of the text the user actually wrote, and the
 * highlight travels as a pair of offsets into that excerpt. No HTML is ever
 * built here, so nothing the notes contain can reach the page as markup.
 */

/**
 * The shortest query that is worth running.
 *
 * One character matches inside almost every word of every note, which is a
 * full scan of the folder to produce a list nobody can use. Two is the point
 * where a query starts saying something («ok», «QA», an initial pair), and it
 * is measured after normalising, so «  é » is one character, not three.
 */
export const MIN_QUERY_LENGTH = 2

/**
 * How many excerpts one note contributes to the results.
 *
 * A word repeated forty times in a long transcript is one note to open, not
 * forty rows: the extra excerpts say nothing new and would push the other
 * notes off the screen. The *count* is not capped — it is what the sort uses —
 * so a note that says it 40 times still ranks above one that says it twice.
 */
export const MAX_MATCHES_PER_FILE = 5

/**
 * How much text surrounds a match inside its excerpt, on each side. Enough to
 * recognise the sentence the phrase was said in without turning a result into
 * a paragraph.
 */
export const SNIPPET_CONTEXT_CHARS = 80

/**
 * How many notes one search reads from disk.
 *
 * The index holds metadata for up to `MAX_WALK_FILES` notes, but a search has
 * to open every body it inspects, and one request should not turn into
 * thousands of file reads. The index is sorted date descending, so the cap
 * keeps the recent notes — the ones a search is nearly always about — and the
 * answer says it stopped short instead of pretending that was everything.
 */
export const MAX_SEARCH_FILES = 500

/** How many notes one search answers with, for the same reason. */
export const MAX_SEARCH_RESULTS = 50

/** Which part of the note an excerpt was cut from. */
export type SearchField = 'title' | 'body'

/** One occurrence, with the text around it and where to highlight. */
export type SearchMatch = {
  field: SearchField
  /**
   * The excerpt as plain text — whitespace collapsed to single spaces, never
   * HTML. The UI decides how to render the highlighted span.
   */
  text: string
  /** Offset into `text` where the highlight starts. */
  start: number
  /** Offset into `text` where the highlight ends, exclusive. */
  end: number
}

/** The little of a note's metadata a result needs to be shown and opened. */
export type SearchNote = {
  relPath: string
  fileName: string
  title: string
  date: string | null
}

export type SearchResult = SearchNote & {
  /** Every occurrence found, title and body together. This is what sorts. */
  matchCount: number
  /** The first `MAX_MATCHES_PER_FILE` of them, each with its excerpt. */
  matches: SearchMatch[]
}

/**
 * A query that is ready to search, or the reason it is not. Modelled as a
 * result rather than a thrown error because «too short» is the state the field
 * is in while the user is still typing, not a failure.
 */
export type PreparedQuery =
  | { ok: true; query: string }
  | { ok: false; reason: 'too-short' }

/** Options a caller may narrow for one note; both default to the constants. */
export type SearchNoteOptions = {
  maxMatches?: number
  contextChars?: number
}

/** Combining marks, what `NFD` splits off a letter — «á» becomes «a». */
const COMBINING = /[\u0300-\u036f]/g

const WHITESPACE = /\s/

/**
 * Normalise a raw query and say whether it is long enough to run.
 *
 * The length is checked on the normalised form, so a query of spaces, or of
 * punctuation that normalises away, is short rather than empty-but-valid.
 */
export function prepareQuery(raw: string): PreparedQuery {
  const query = fold(raw).text.trim()
  if (query.length < MIN_QUERY_LENGTH) return { ok: false, reason: 'too-short' }
  return { ok: true, query }
}

/**
 * Search one note, title first and then body, and build its result — or null
 * when the phrase is not in it.
 *
 * `query` is the normalised string `prepareQuery` returned, not what the user
 * typed: a search runs this once per note, and normalising the needle for each
 * one of hundreds of notes would be the same work done hundreds of times.
 *
 * The body arrives as an argument rather than being read here, which is what
 * lets the route open one file at a time and stop when it has read enough.
 */
export function searchNote(
  query: string,
  note: SearchNote,
  body: string,
  options: SearchNoteOptions = {},
): SearchResult | null {
  const maxMatches = options.maxMatches ?? MAX_MATCHES_PER_FILE
  const contextChars = options.contextChars ?? SNIPPET_CONTEXT_CHARS

  // The title goes first and takes from the same budget: a note whose *title*
  // is the phrase should show that, not the fifth time it appears in the body.
  const title = findMatches(query, note.title, 'title', { maxMatches, contextChars })
  const rest = maxMatches - title.matches.length
  const text = findMatches(query, body, 'body', { maxMatches: rest, contextChars })

  const matchCount = title.count + text.count
  if (matchCount === 0) return null

  return {
    relPath: note.relPath,
    fileName: note.fileName,
    title: note.title,
    date: note.date,
    matchCount,
    matches: [...title.matches, ...text.matches],
  }
}

/** What one field of one note produced: every hit counted, the first few cut. */
export type FieldMatches = {
  /** How many times the phrase occurs in the field, uncapped. */
  count: number
  /** Excerpts for the first `maxMatches` of them, in the order they appear. */
  matches: SearchMatch[]
}

/**
 * Every occurrence of `query` in `text`, with an excerpt for the first few.
 *
 * Occurrences do not overlap: «aa» is found once in «aaa», which is what a
 * person counting out loud would say. `maxMatches` bounds only the excerpts —
 * counting is a scan of an already-normalised string and costs nothing.
 */
export function findMatches(
  query: string,
  text: string,
  field: SearchField,
  options: SearchNoteOptions = {},
): FieldMatches {
  const maxMatches = Math.max(0, options.maxMatches ?? MAX_MATCHES_PER_FILE)
  const contextChars = options.contextChars ?? SNIPPET_CONTEXT_CHARS

  // An empty needle is in every haystack at every position; it would also
  // never advance the loop below.
  if (!query) return { count: 0, matches: [] }

  const { text: folded, offsets } = fold(text)
  const matches: SearchMatch[] = []
  let count = 0
  let from = 0

  for (;;) {
    const at = folded.indexOf(query, from)
    if (at < 0) break

    count += 1
    if (matches.length < maxMatches) {
      // `offsets` maps back to what the user wrote, which is what the excerpt
      // is cut from — the normalised string is only ever the place to look.
      matches.push(excerpt(text, offsets[at], offsets[at + query.length], field, contextChars))
    }
    from = at + query.length
  }

  return { count, matches }
}

/**
 * The results in the order they are shown: most occurrences first, and among
 * notes that say it equally often the most recent one — a phrase from last
 * week is nearly always the one being looked for. Undated notes go last, as
 * they do in every listing, and the title breaks the remaining ties so the
 * order does not depend on which file the walk happened to reach first.
 */
export function sortResults(results: readonly SearchResult[]): SearchResult[] {
  return [...results].sort(compareResults)
}

function compareResults(a: SearchResult, b: SearchResult): number {
  if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount
  if (a.date !== b.date) {
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  }
  return a.title.localeCompare(b.title)
}

/** The text, folded, plus where in the original each character came from. */
type Folded = {
  /** Lowercase, without diacritics, whitespace runs collapsed to one space. */
  text: string
  /**
   * `offsets[i]` is the index in the original of the character that produced
   * `text[i]`, and `offsets[text.length]` is the original length. So a hit at
   * `[i, j)` of `text` covers `[offsets[i], offsets[j])` of the original —
   * including whatever was dropped in between, which is how a stripped accent
   * ends up inside the highlight rather than beside it.
   */
  offsets: number[]
}

/**
 * Fold a text for searching, keeping a map back to it.
 *
 * The map is the whole point. Normalising with `normalize('NFD')` over a whole
 * string changes its length — a decomposed «á» is two characters, a collapsed
 * run of spaces is one — so positions found in the normalised text mean
 * nothing in the original. Folding character by character and recording where
 * each one came from keeps both: a needle is found in text that ignores case,
 * accents and line breaks, and the excerpt is still cut on the real thing.
 */
function fold(input: string): Folded {
  let text = ''
  const offsets: number[] = []
  let at = 0
  let lastWasSpace = false

  // Iterating the string yields code points, so a character outside the BMP is
  // folded as one unit; `at` counts the UTF-16 indices `slice` will need.
  for (const char of input) {
    const start = at
    at += char.length

    // A line break inside a note is not a word boundary the user typed on
    // purpose: collapsing runs is what makes a phrase match across the wrap.
    if (WHITESPACE.test(char)) {
      if (lastWasSpace) continue
      lastWasSpace = true
      text += ' '
      offsets.push(start)
      continue
    }

    lastWasSpace = false
    // Decompose, drop the marks, *then* lowercase — in that order, because
    // lowercasing first turns «İ» into an «i» plus a mark that is no longer
    // attached to anything, and «istanbul» would stop matching «İstanbul».
    const folded = char.normalize('NFD').replace(COMBINING, '').toLowerCase()
    // One character can still fold to several units, or to none when it was a
    // combining mark on its own; either way every unit points at the same
    // origin, and what folds to nothing is absorbed by the character after it.
    for (let i = 0; i < folded.length; i += 1) offsets.push(start)
    text += folded
  }

  offsets.push(input.length)
  return { text, offsets }
}

/**
 * Cut the excerpt for one occurrence out of the original text.
 *
 * The window is grown to `contextChars` on each side and then pulled back to
 * the nearest space, so an excerpt opens and closes on a whole word — except
 * at the edges of the text, where there is nothing to pull back to and the
 * excerpt simply starts at the beginning or ends at the end.
 */
function excerpt(
  text: string,
  start: number,
  end: number,
  field: SearchField,
  contextChars: number,
): SearchMatch {
  const from = wordStart(text, Math.max(0, start - contextChars), start)
  const to = wordEnd(text, Math.min(text.length, end + contextChars), end)

  // Collapsed piece by piece: the three lengths are what the offsets are made
  // of, so they have to be measured on the text that is actually returned.
  const before = collapse(text.slice(from, start)).trimStart()
  const matched = collapse(text.slice(start, end))
  const after = collapse(text.slice(end, to)).trimEnd()

  return {
    field,
    text: before + matched + after,
    start: before.length,
    end: before.length + matched.length,
  }
}

/** Whitespace collapsed the same way `fold` collapses it, so both agree. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/** `from` moved forward to just after a space, never past `limit`. */
function wordStart(text: string, from: number, limit: number): number {
  if (from === 0) return 0
  for (let i = from; i < limit; i += 1) {
    if (WHITESPACE.test(text[i])) return i + 1
  }
  return from
}

/** `to` moved back to just before a space, never before `limit`. */
function wordEnd(text: string, to: number, limit: number): number {
  if (to >= text.length) return text.length
  for (let i = to; i > limit; i -= 1) {
    if (WHITESPACE.test(text[i - 1])) return i - 1
  }
  return to
}
