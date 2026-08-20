/**
 * Decisions, risks and open questions, as Markdown you can paste somewhere.
 *
 * These three lists never reach Linear — an issue is for work somebody owes,
 * and none of this is work — so the only way they leave the app is the
 * clipboard: into the meeting note itself, an email, a channel. That makes the
 * conversion the whole feature, and it is pure text in, pure text out so the
 * test suite can hold it to its shape.
 *
 * `insightEntries` is deliberately shared with the panel that draws these
 * lists: the bullet the clipboard gets is built from the very same three
 * fields the row shows, so what was copied is what was read.
 */

import type {
  ExtractedDecision,
  ExtractedQuestion,
  ExtractedRisk,
  MeetingInsights,
} from './extractors/task'

/** Which of the three lists. The keys are `MeetingInsights`'s own. */
export type InsightKind = keyof MeetingInsights

/** In the order they are read: what was settled, what threatens it, what is unresolved. */
export const INSIGHT_KINDS: readonly InsightKind[] = ['decisions', 'risks', 'openQuestions']

/** The heading of each list, in the words the user reads on screen. */
export const INSIGHT_HEADINGS: Record<InsightKind, string> = {
  decisions: 'Decisiones',
  risks: 'Riesgos',
  openQuestions: 'Preguntas abiertas',
}

/**
 * One item of any of the three lists, flattened to what they have in common:
 * what it says, the one field that qualifies it — who decided, what is at
 * stake — and the transcript line that proves it.
 *
 * `note` is null for an open question, which has no second field, and for a
 * decision or a risk the model could not attribute.
 */
export type InsightEntry = {
  text: string
  note: string | null
  evidence: string
}

/**
 * One list as entries, with its qualifying field already worded.
 *
 * The wording is here rather than in the panel because the clipboard and the
 * screen must not be able to disagree about what `decidedBy` means: «Ana» on
 * its own next to a decision could be read as the person it is assigned to.
 */
export function insightEntries(
  insights: MeetingInsights,
  kind: InsightKind,
): InsightEntry[] {
  if (kind === 'decisions') return insights.decisions.map(decisionEntry)
  if (kind === 'risks') return insights.risks.map(riskEntry)
  return insights.openQuestions.map(questionEntry)
}

/**
 * One list as Markdown: a level-two heading and one bullet per item, with the
 * evidence quoted underneath it as a blockquote.
 *
 * A list with nothing in it — or with nothing but blank items — is the empty
 * string, never a lone heading: the point of copying is to paste, and a
 * heading with no bullets under it reads as «this meeting decided nothing»
 * when what actually happened is that nobody asked for the list.
 */
export function listMarkdown(insights: MeetingInsights, kind: InsightKind): string {
  const bullets = insightEntries(insights, kind).map(bulletOf).filter((line) => line !== '')

  if (bullets.length === 0) return ''

  return [`## ${INSIGHT_HEADINGS[kind]}`, '', ...bullets].join('\n')
}

/**
 * The three lists at once, in reading order, separated by a blank line.
 *
 * Empty lists are left out rather than rendered as empty sections, exactly as
 * they are left out of the panel: what is copied is what was on screen.
 * Nothing extracted at all is the empty string, and the caller is expected not
 * to offer the control in that case — there is no list to copy.
 */
export function insightsMarkdown(insights: MeetingInsights): string {
  return INSIGHT_KINDS.map((kind) => listMarkdown(insights, kind))
    .filter((section) => section !== '')
    .join('\n\n')
}

/** How many items the three lists hold between them. */
export function insightsCount(insights: MeetingInsights): number {
  return insights.decisions.length + insights.risks.length + insights.openQuestions.length
}

/** Nothing was extracted beyond the tasks — the panel does not exist at all. */
export function hasInsights(insights: MeetingInsights): boolean {
  return insightsCount(insights) > 0
}

/**
 * One bullet, or the empty string for an item with nothing to say.
 *
 * Everything is collapsed onto a single line: a model answer with a newline in
 * it would otherwise break out of the bullet and turn the rest of the item
 * into a paragraph of its own once pasted.
 */
function bulletOf(entry: InsightEntry): string {
  const text = oneLine(entry.text)
  if (!text) return ''

  const note = oneLine(entry.note ?? '')
  const evidence = oneLine(entry.evidence)
  const bullet = note ? `- ${text} — ${note}` : `- ${text}`

  // Indented so the quote belongs to the bullet above it rather than to the
  // list, and only when there is one: an item added without evidence — or one
  // whose evidence the model left blank — gets a bullet and nothing else.
  return evidence ? `${bullet}\n  > ${evidence}` : bullet
}

function decisionEntry(decision: ExtractedDecision): InsightEntry {
  return {
    text: decision.text,
    note: decision.decidedBy ? `decidido por ${decision.decidedBy}` : null,
    evidence: decision.evidence,
  }
}

function riskEntry(risk: ExtractedRisk): InsightEntry {
  return {
    text: risk.text,
    note: risk.affects ? `afecta a ${risk.affects}` : null,
    evidence: risk.evidence,
  }
}

/** An open question has no second field: the question is the whole of it. */
function questionEntry(question: ExtractedQuestion): InsightEntry {
  return { text: question.text, note: null, evidence: question.evidence }
}

/** Any run of whitespace — newlines included — becomes one space. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
