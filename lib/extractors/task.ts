/**
 * What an extractor produces, and everything both extractors must agree on:
 * the task type, the JSON Schema handed to the model as a structured-output
 * contract, the prompts, and the normalisation applied to whatever comes back.
 *
 * Ollama (`./ollama`) and the Claude API (`./claude`) speak different HTTP,
 * but a task extracted by one has to be indistinguishable from a task
 * extracted by the other — the UI and the Linear push only ever see this type.
 */

import type { TranscriptMeta } from '../transcripts'

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
 * by Anthropic and converts to a flimsier grammar in Ollama.
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
  },
  required: ['tasks'],
  additionalProperties: false,
} as const

/**
 * The extraction instructions. Deliberately blunt about not inventing work:
 * a small local model asked for "the tasks" will happily manufacture plausible
 * ones for a transcript that contains none, and a fabricated task costs the
 * user a real Linear issue to clean up.
 */
export const SYSTEM_PROMPT = [
  'You extract action items from meeting transcripts.',
  '',
  'Rules:',
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
    'Extract the action items as JSON.',
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
