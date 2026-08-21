/**
 * What an extractor produces, and everything both extractors must agree on:
 * the four result types, the JSON Schema handed to the model as a
 * structured-output contract, the prompts, and the normalisation applied to
 * whatever comes back.
 *
 * Ollama (`./ollama`) and the Claude API (`./claude`) speak different HTTP,
 * but a task extracted by one has to be indistinguishable from a task
 * extracted by the other — the UI and the Linear push only ever see these
 * types.
 *
 * An extraction reads four things out of a meeting: the tasks, which are the
 * only ones that become Linear issues, and the decisions, risks and open
 * questions, which are what the meeting *knew* and is about to forget.
 */

import type { TranscriptMeta } from '../transcripts'

/**
 * The signal one extraction request runs under: its own timeout, and the
 * caller's cancellation when there is one.
 *
 * `AbortSignal.any` rather than picking one of the two, because they answer
 * different questions and both have to be able to stop the call: the timeout
 * is «this provider is never going to answer», the caller is «nobody is
 * waiting for this any more». Dropping the timeout when a caller passes a
 * signal would leave a wedged provider hanging a request that no clock owns.
 */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** Linear's own priority scale, lowercased. `none` is the fallback. */
export const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const

export type Priority = (typeof PRIORITIES)[number]

/** One action item extracted from a transcript, before the user edits it. */
export type ExtractedTask = {
  /** Imperative one-liner. A task without one is dropped. */
  title: string
  description: string
  priority: Priority
  /** Who the transcript put on the hook, verbatim; null when nobody was named. */
  mentioned: string | null
  /**
   * The deadline the transcript names, as `YYYY-MM-DD`; null when it names
   * none, or when what the model answered was not a real calendar date.
   */
  dueDate: string | null
  /** The line from the transcript that justifies the task, quoted verbatim. */
  evidence: string
}

/**
 * One choice the meeting settled. Deliberately not a task: a decision is a
 * state of the world («we go with Postgres»), a task is work somebody owes
 * («Ana migra la base el viernes»), and one sentence can contain both.
 */
export type ExtractedDecision = {
  /** What was decided, in English. A decision without one is dropped. */
  text: string
  /** Who made the call, verbatim; null when the transcript does not say. */
  decidedBy: string | null
  /** The line from the transcript that proves it, quoted verbatim. */
  evidence: string
}

/** Something the meeting flagged as able to go wrong. */
export type ExtractedRisk = {
  /** What could go wrong, in English. A risk without one is dropped. */
  text: string
  /** What it puts at risk — a date, a deliverable, a team; null when unsaid. */
  affects: string | null
  /** The line from the transcript that proves it, quoted verbatim. */
  evidence: string
}

/** Something the meeting asked and did not answer. */
export type ExtractedQuestion = {
  /** The open question, in English. A question without one is dropped. */
  text: string
  /** The line from the transcript that proves it, quoted verbatim. */
  evidence: string
}

/**
 * What the meeting knew and is about to forget: everything an extraction
 * produces *except* the tasks.
 *
 * They are named apart from the tasks because that is how they travel from
 * here on: nothing in this group is ever pushed to Linear, nothing in it is
 * counted by the push button, and it is stored, restored and copied as a unit
 * (`lib/insights-markdown.ts`, `lib/drafts-store.ts`).
 */
export type MeetingInsights = {
  decisions: ExtractedDecision[]
  risks: ExtractedRisk[]
  openQuestions: ExtractedQuestion[]
}

/**
 * The whole of one extraction. The tasks are what the Linear push consumes —
 * the other three lists never leave the app — but they travel together because
 * they come out of a single read of the transcript.
 *
 * Every list may be empty, including all four at once: a transcript that
 * settled nothing and asked nothing is a valid meeting.
 */
export type ExtractionResult = { tasks: ExtractedTask[] } & MeetingInsights

/** Three empty lists. A fresh object every call. */
export function emptyInsights(): MeetingInsights {
  return { decisions: [], risks: [], openQuestions: [] }
}

/** A result with nothing in it. A fresh object every call. */
export function emptyExtraction(): ExtractionResult {
  return { tasks: [], ...emptyInsights() }
}

/** An extractor failed in a way the user can act on. Routes answer 502. */
export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ExtractionError'
  }
}

/**
 * The structured-output contract. Both providers take a JSON Schema — Ollama
 * in `format`, Anthropic in `output_config.format` — so it is written once
 * here and stays inside the subset both accept: an object at the top level,
 * every property required, `additionalProperties: false`, and nullability
 * expressed as a type union rather than `anyOf`.
 *
 * The wrapper object exists because a bare array at the top level is rejected
 * by Anthropic and converts to a flimsier grammar in Ollama — and it is what
 * lets one call answer four lists instead of one.
 */
export const TASKS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Imperative one-line summary of the action item, in English.',
          },
          description: {
            type: 'string',
            description:
              'One or two sentences of context in English — what has to happen, for whom and by when. Never a copy of the evidence line.',
          },
          priority: {
            type: 'string',
            enum: [...PRIORITIES],
            description:
              'urgent (blocking or due immediately), high (has a near deadline), medium, low (explicitly not urgent), none (the transcript says nothing about urgency).',
          },
          mentioned: {
            type: ['string', 'null'],
            description:
              'Name of the person the transcript put in charge, exactly as written. Null if nobody was named.',
          },
          dueDate: {
            type: ['string', 'null'],
            description:
              'Absolute deadline in YYYY-MM-DD format, resolved against the meeting date when the transcript says it relatively. Null when the transcript sets no deadline.',
          },
          evidence: {
            type: 'string',
            description:
              'The sentence from the transcript that proves this task exists, copied verbatim in its original language.',
          },
        },
        required: ['title', 'description', 'priority', 'mentioned', 'dueDate', 'evidence'],
        additionalProperties: false,
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              'The choice the meeting settled, as one sentence in English. A state of the world once the meeting ended, never work somebody owes.',
          },
          decidedBy: {
            type: ['string', 'null'],
            description:
              'Name of the person who made the call, exactly as the transcript writes it. Null when the transcript does not say who decided.',
          },
          evidence: {
            type: 'string',
            description:
              'The sentence from the transcript that proves this decision was taken, copied verbatim in its original language.',
          },
        },
        required: ['text', 'decidedBy', 'evidence'],
        additionalProperties: false,
      },
    },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              'What the meeting flagged as able to go wrong, as one sentence in English.',
          },
          affects: {
            type: ['string', 'null'],
            description:
              'What this risk puts at stake — a deliverable, a date, a team — as the transcript frames it. Null when the transcript does not say.',
          },
          evidence: {
            type: 'string',
            description:
              'The sentence from the transcript that proves this risk was raised, copied verbatim in its original language.',
          },
        },
        required: ['text', 'affects', 'evidence'],
        additionalProperties: false,
      },
    },
    openQuestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              'A question the meeting asked and left unanswered, as one sentence in English.',
          },
          evidence: {
            type: 'string',
            description:
              'The sentence from the transcript where the question was asked, copied verbatim in its original language.',
          },
        },
        required: ['text', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks', 'decisions', 'risks', 'openQuestions'],
  additionalProperties: false,
} as const

/**
 * The extraction instructions. Deliberately blunt about not inventing work:
 * a small local model asked for "the tasks" will happily manufacture plausible
 * ones for a transcript that contains none, and a fabricated task costs the
 * user a real Linear issue to clean up. The three lists that are not tasks get
 * the rule stated just as bluntly — a fabricated decision is worse, because
 * nothing downstream reviews it before the user believes it.
 */
export const SYSTEM_PROMPT = [
  'You extract four things from meeting transcripts: action items, decisions, risks and open questions.',
  '',
  'Rules for action items ("tasks"):',
  '- Extract ONLY real commitments: something a person agreed to do, was asked to do, or was assigned. Decisions, opinions, status updates and general discussion are NOT tasks.',
  '- NEVER invent, infer or embellish a task. If the transcript contains no commitments, return an empty list. An empty list is a correct answer.',
  '- Every task must be backed by "evidence": the sentence from the transcript that proves it, copied verbatim in the transcript\'s original language. Never paraphrase the evidence.',
  '- Write "title" and "description" in English, even when the transcript is in another language. The title is imperative and one line ("Send the Q3 budget to Marta"), never a restatement of the whole discussion.',
  '- The description is your own English sentence about the task — who owes what, to whom, and by when. Translating or copying the evidence line into it is wrong.',
  '- "mentioned" is the name of the person put in charge, exactly as the transcript writes it, or null when nobody was named. Never guess an owner.',
  '- "dueDate" is the deadline the transcript sets, always as an absolute YYYY-MM-DD date. Resolve relative wording ("el viernes", "in two weeks", "before the end of the month") against the meeting date given in the header, and answer with the resulting calendar date.',
  '- When the transcript sets no deadline, or when there is no meeting date to resolve a relative one against, "dueDate" is null. Never invent a date, and never answer with the relative phrase itself.',
  '- "priority" reflects the urgency the transcript itself expresses: urgent when it blocks someone or is due immediately, high when a near deadline is named, low when it is explicitly not urgent, none when urgency is never mentioned.',
  '- Do not merge two commitments into one task, and do not split one commitment into several.',
  '',
  'Rules for decisions, risks and open questions:',
  '- A DECISION is a choice the meeting settled: an option chosen, a plan approved, a course of action agreed. A decision is NOT a task. "We are going with Postgres" is a decision; "Ana migrates the database on Friday" is a task. When one sentence carries both, extract both, each in its own list.',
  '- "decidedBy" is the person who made the call, exactly as the transcript names them, or null when the transcript does not say. Never attribute a decision to whoever happened to be speaking.',
  '- A RISK is something the meeting flagged as able to go wrong: a blocker, a dependency, a date that looks tight, a cost. Its "affects" is what it puts at stake — a deliverable, a date, a team — as the transcript frames it, or null when that is not said.',
  '- An OPEN QUESTION is something the meeting asked and did NOT answer. A question answered later in the transcript is not open, and a request phrased as a question ("¿me pasas el presupuesto?") is a task, not an open question.',
  '- Every decision, risk and open question carries "evidence" exactly like a task: the sentence from the transcript that proves it, copied verbatim in the transcript\'s original language. Never paraphrase it. Write the "text" of each in English.',
  '- NEVER invent, infer or embellish a decision, a risk or an open question. Extract only what the transcript actually states.',
  '- Any of the four lists may come back empty, and all four empty at once is a correct answer for a transcript that decided nothing and asked nothing. Padding a list so it does not look empty is the worst possible answer.',
].join('\n')

/** The transcript, with the little context the model needs to read it. */
export function buildUserPrompt(transcript: string, meta: TranscriptMeta): string {
  const header = [
    `Title: ${meta.title}`,
    meta.date
      ? `Meeting date: ${meta.date} — resolve every relative deadline against this date.`
      : 'Meeting date: unknown — relative deadlines cannot be resolved, so leave dueDate null.',
    meta.attendees.length > 0 ? `Attendees: ${meta.attendees.join(', ')}` : null,
  ].filter((line): line is string => line !== null)

  return [
    ...header,
    '',
    'Transcript:',
    transcript.trim(),
    '',
    'Extract the action items, decisions, risks and open questions as JSON.',
  ].join('\n')
}

/**
 * Turn the model's answer into `ExtractedTask[]`. Structured output constrains
 * the shape but not the content, so this is where the guarantees the rest of
 * the app relies on are actually made: no empty titles, always a known
 * priority, `mentioned` either a non-empty string or null.
 *
 * Accepts either the `{ tasks: [...] }` wrapper the schema asks for or a bare
 * array, which models occasionally answer with anyway. Anything else yields an
 * empty array — a transcript with no commitments is a valid outcome, so a
 * result with no usable rows is not an error here; callers that need to tell
 * "no tasks" from "no answer" check the parse, not this.
 */
export function normalizeTasks(payload: unknown): ExtractedTask[] {
  const list = taskList(payload)

  return list
    .map(normalizeTask)
    .filter((task): task is ExtractedTask => task !== null)
}

/**
 * The whole answer, as `ExtractionResult`. This is what both extractors return.
 *
 * Each list is normalised independently and a missing one is simply empty: a
 * model that only answered `tasks` — an older local model, or one that read the
 * schema loosely — still produces a valid result, and the three new lists read
 * as "the meeting settled nothing" rather than as a failure. That is the same
 * rule `normalizeTasks` already applies to a payload with no tasks.
 */
export function normalizeExtraction(payload: unknown): ExtractionResult {
  return { tasks: normalizeTasks(payload), ...normalizeInsights(payload) }
}

/**
 * The three lists that are not tasks, from a payload that carries them at the
 * top level — which is both what a model answers and what `.data/drafts.json`
 * stores, so a restored note is sieved by exactly the rules the extraction was.
 */
export function normalizeInsights(payload: unknown): MeetingInsights {
  return {
    decisions: normalizeList(payload, 'decisions', normalizeDecision),
    risks: normalizeList(payload, 'risks', normalizeRisk),
    openQuestions: normalizeList(payload, 'openQuestions', normalizeQuestion),
  }
}

/**
 * One of the three lists that are not tasks, cleaned entry by entry.
 *
 * Unlike `normalizeTasks` there is no bare-array fallback here: a bare array at
 * the root is the shape a model answers when it read the request as "give me
 * the tasks", so reading it as decisions would invent a list the model never
 * meant to send.
 */
function normalizeList<T>(
  payload: unknown,
  key: string,
  normalize: (raw: Record<string, unknown>) => T | null,
): T[] {
  if (typeof payload !== 'object' || payload === null) return []
  const list = (payload as Record<string, unknown>)[key]
  if (!Array.isArray(list)) return []

  return list
    .filter((raw): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null)
    .map(normalize)
    .filter((entry): entry is T => entry !== null)
}

/** One decision, or null when it says nothing — an entry with no text is noise. */
function normalizeDecision(raw: Record<string, unknown>): ExtractedDecision | null {
  const cleanText = text(raw.text)
  if (!cleanText) return null

  return {
    text: cleanText,
    decidedBy: text(raw.decidedBy) || null,
    evidence: text(raw.evidence),
  }
}

/** One risk, or null when it says nothing. */
function normalizeRisk(raw: Record<string, unknown>): ExtractedRisk | null {
  const cleanText = text(raw.text)
  if (!cleanText) return null

  return {
    text: cleanText,
    affects: text(raw.affects) || null,
    evidence: text(raw.evidence),
  }
}

/** One open question, or null when it says nothing. */
function normalizeQuestion(raw: Record<string, unknown>): ExtractedQuestion | null {
  const cleanText = text(raw.text)
  if (!cleanText) return null

  return { text: cleanText, evidence: text(raw.evidence) }
}

function taskList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (typeof payload !== 'object' || payload === null) return []
  const tasks = (payload as { tasks?: unknown }).tasks
  return Array.isArray(tasks) ? tasks : []
}

/** One raw entry, or null when it carries no title to show. */
function normalizeTask(raw: unknown): ExtractedTask | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { title, description, priority, mentioned, dueDate, evidence } = raw as Record<
    string,
    unknown
  >

  const cleanTitle = text(title)
  if (!cleanTitle) return null

  return {
    title: cleanTitle,
    description: text(description),
    priority: normalizePriority(priority),
    mentioned: text(mentioned) || null,
    dueDate: normalizeDueDate(dueDate),
    evidence: text(evidence),
  }
}

/**
 * Only a real calendar day survives, as `YYYY-MM-DD`. It is exported because
 * `POST /api/linear/push` needs the very same rule on the date the browser
 * sends: a row the user typed by hand never went through the extractor.
 *
 * Models answer this field
 * with the relative phrase they were told to resolve ("next Friday"), with a
 * full ISO timestamp, or with a date that does not exist (`2026-02-31`); the
 * first and the last are worse than no date at all, because they reach Linear
 * as a rejected mutation or as a deadline nobody agreed to.
 *
 * The time part of a timestamp is dropped rather than disqualifying it: the
 * day is the whole answer, and a model that adds `T00:00:00Z` still got it.
 */
export function normalizeDueDate(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value.trim())
  if (!match) return null

  const [, year, month, day] = match
  if (Number(day) < 1 || Number(day) > daysInMonth(Number(year), Number(month))) return null

  return `${year}-${month}-${day}`
}

/** 0 for a month outside 1–12, so any day of it is out of range. */
function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return lengths[month - 1] ?? 0
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Anything outside Linear's scale — including `null` or a made-up level — is `none`. */
function normalizePriority(value: unknown): Priority {
  const candidate = text(value).toLowerCase()
  return (PRIORITIES as readonly string[]).includes(candidate) ? (candidate as Priority) : 'none'
}

/** Models answer with numbers and nulls where a string was asked for. */
function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}
