/**
 * How much two task titles look like the same task.
 *
 * The duplicate check runs over every row of a table against every issue that
 * already exists in the destination, which is hundreds of comparisons for a
 * single note — far too many to ask a model about, and the answer has to be
 * there before the user decides what to push. So the score is arithmetic:
 * pure, synchronous, and cheap enough to redo on every keystroke if need be.
 *
 * Nothing here reads the filesystem, the network or `process.env`, and nothing
 * is imported from `node:`. The module is meant to run unchanged in the
 * browser bundle and on the server, so both sides of the check agree.
 */

/**
 * The score above which two titles are treated as the same task.
 *
 * Measured on the two things that actually collide in this app. A task the
 * model wrote and the same task typed by hand in Linear — «Migrar endpoint de
 * pagos» vs «Migración del endpoint de pagos» (0.73), «Enviar el presupuesto a
 * Marta» vs «Mandar presupuesto a Marta» (0.73), «Actualizar la documentación
 * del API» vs «Actualizar docs de la API» (0.68) — lands from 0.58 up. Two
 * genuinely different tasks about the same subject, which is the hard case
 * because they share the jargon and the product names, peak around 0.50
 * («Migrar endpoint de pagos a la nueva API» vs «Documentar el endpoint de
 * pagos en la wiki»); unrelated tasks sit below 0.30. 0.55 is the middle of
 * that gap.
 *
 * The gap is narrow, so the check is built to be read rather than obeyed: the
 * match and its score are shown next to the row either way, and nothing is
 * blocked. What the threshold decides is only whether the row is flagged.
 */
export const DUPLICATE_THRESHOLD = 0.55

/** An element of the list `bestMatch` was given, and how close it came. */
export type Match<T> = {
  item: T
  /** Between 0 and 1, the `similarity` of that element to the candidate. */
  score: number
}

/**
 * Words that say nothing about *which* task this is. Spanish and English
 * together, because a note is dictated in one language and its issues are
 * often written in the other — dropping only one list would score a title
 * against its own translation lower than against an unrelated title.
 */
const STOP_WORDS = new Set([
  // Español
  'a', 'al', 'ante', 'con', 'contra', 'de', 'del', 'desde', 'e', 'el', 'ella',
  'ellos', 'en', 'entre', 'era', 'es', 'esa', 'ese', 'eso', 'esta', 'este',
  'esto', 'estos', 'ha', 'hacia', 'han', 'hasta', 'la', 'las', 'le', 'les',
  'lo', 'los', 'mas', 'me', 'mi', 'mis', 'ni', 'no', 'nos', 'o', 'para', 'pero',
  'por', 'que', 'se', 'segun', 'ser', 'si', 'sin', 'sobre', 'son', 'su', 'sus',
  'tras', 'tu', 'tus', 'un', 'una', 'unas', 'unos', 'y', 'ya',
  // English
  'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for',
  'from', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'out',
  'the', 'their', 'this', 'to', 'was', 'were', 'with',
])

/**
 * Verbs a task title opens with out of habit. «Revisar el contrato» and
 * «Contrato de alquiler» are the same piece of work; keeping the verb would
 * instead pull every «Revisar …» towards every other «Revisar …», which is the
 * one word a list of pending tasks is guaranteed to repeat.
 */
const FILLER_VERBS = new Set([
  'hacer', 'haz', 'hagamos', 'realizar', 'revisar', 'revisa', 'revisemos',
  'chequear', 'checar', 'mirar', 'ver', 'do', 'check', 'checking',
])

/** Only the token weight is spelled out; the bigram half is what is left. */
const TOKEN_WEIGHT = 0.6

/**
 * The text reduced to what the comparison is allowed to look at: lowercase,
 * without diacritics, without punctuation, single-spaced, and stripped of the
 * words above.
 *
 * The stripping is undone whenever it would leave nothing behind: «Revisarlo»
 * survives as itself, and so does a title that is one stop word long. A title
 * normalised to the empty string scores 0 against everything, which is the
 * right answer for «» and the wrong one for a short but real task.
 */
export function normalizeForMatch(text: string): string {
  const plain = text
    .normalize('NFD')
    // Combining marks — this is what turns «migración» into «migracion» and,
    // deliberately, «ñ» into «n»: a title typed without the tilde is the same
    // title.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Everything that is not a letter or a digit is a separator, so «pagos.»,
    // «pagos,» and «(pagos)» are all the same token.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (!plain) return ''

  const tokens = plain.split(' ')
  const kept = tokens.filter((token) => !STOP_WORDS.has(token) && !FILLER_VERBS.has(token))
  return (kept.length > 0 ? kept : tokens).join(' ')
}

/**
 * How alike two texts are, between 0 (nothing in common) and 1 (the same text
 * once normalised).
 *
 * Two measures, half and half, because either one alone is wrong in a way the
 * other is not. Tokens carry the meaning, but they are all-or-nothing:
 * «migrar» and «migración» are a miss, so a reformulated title would score as
 * a stranger. Character bigrams see through the endings, but they also see
 * through the words — two long, unrelated Spanish texts share `de`, `os`, `ci`
 * and the rest by accident. Requiring both to agree is what keeps «Migrar
 * endpoint de pagos» close to «Migración del endpoint de pagos» without
 * dragging every long sentence towards every other one.
 */
export function similarity(a: string, b: string): number {
  return scoreNormalized(normalizeForMatch(a), normalizeForMatch(b))
}

/**
 * The element of `existing` that looks most like `candidate`, or null when
 * there is nothing to compare against.
 *
 * The score is reported as it is, without applying `DUPLICATE_THRESHOLD`: the
 * caller decides what to do with a 0.58, and the UI shows the number either
 * way. Ties keep the first element, so the order the destination returned its
 * issues in is the order the user sees.
 *
 * `text` says which part of an element to read; it defaults to the element
 * itself, so a plain list of strings needs no accessor.
 */
export function bestMatch<T>(
  candidate: string,
  existing: readonly T[],
  text: (item: T) => string = (item) => String(item),
): Match<T> | null {
  // Normalised once and reused: a table checks every row against the whole
  // destination, and this is the string that would otherwise be rebuilt for
  // each of the hundreds of comparisons.
  const normalized = normalizeForMatch(candidate)

  let best: Match<T> | null = null
  for (const item of existing) {
    const score = scoreNormalized(normalized, normalizeForMatch(text(item)))
    if (!best || score > best.score) best = { item, score }
  }

  return best
}

/** The measure itself, over texts that are already normalised. */
function scoreNormalized(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const tokens = dice(count(a.split(' ')), count(b.split(' ')))
  const bigramsA = count(bigrams(a))
  const bigramsB = count(bigrams(b))

  // A one-character text has no bigrams to compare; its tokens are all there
  // is to go on, and averaging in a 0 would halve a legitimate match.
  if (bigramsA.size === 0 || bigramsB.size === 0) return tokens

  return TOKEN_WEIGHT * tokens + (1 - TOKEN_WEIGHT) * dice(bigramsA, bigramsB)
}

/** Adjacent character pairs, spaces included — they mark where words end. */
function bigrams(text: string): string[] {
  const pairs: string[] = []
  for (let i = 0; i + 1 < text.length; i += 1) pairs.push(text.slice(i, i + 2))
  return pairs
}

/** How many times each item appears, so a repeat is not silently one item. */
function count(items: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

/**
 * Sørensen–Dice over two multisets: twice what they share, over what they hold
 * between them. Length differences cost, which is what keeps a three-word
 * title from matching the paragraph that happens to contain it.
 */
function dice(a: Map<string, number>, b: Map<string, number>): number {
  let shared = 0
  let sizeA = 0
  let sizeB = 0

  for (const [, times] of a) sizeA += times
  for (const [item, times] of b) {
    sizeB += times
    shared += Math.min(times, a.get(item) ?? 0)
  }

  if (sizeA + sizeB === 0) return 0
  return (2 * shared) / (sizeA + sizeB)
}
