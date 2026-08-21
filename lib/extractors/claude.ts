/**
 * Extraction through the Anthropic Messages API.
 *
 * The counterpart of `./ollama`: same prompts, same schema, same cleanup — all
 * of it lives in `./task` — so a task extracted here is indistinguishable from
 * one extracted locally. This module owns only the HTTP.
 */

import type { TranscriptMeta } from '../transcripts'
import {
  ExtractionError,
  SYSTEM_PROMPT,
  TASKS_JSON_SCHEMA,
  buildUserPrompt,
  normalizeExtraction,
  withTimeout,
  type ExtractionResult,
} from './task'

/** Overridable so the app can be pointed at a stub, like `LINEAR_API_URL`. */
export const ANTHROPIC_API_URL =
  process.env.ANTHROPIC_API_URL ?? 'https://api.anthropic.com/v1/messages'

/** The only API version this request shape is written against. */
const ANTHROPIC_VERSION = '2023-06-01'

export const CLAUDE_MODEL = 'claude-sonnet-5'

/**
 * Budget for the whole answer. On this model thinking is on by default and is
 * billed against the same ceiling as the JSON, so this is sized for both; a
 * truncated answer comes back as `stop_reason: 'max_tokens'` and is reported
 * as such rather than being parsed into half a task list.
 */
const MAX_TOKENS = 16000

/** Long transcripts think for a while; a bound still beats a hung request. */
const EXTRACTION_TIMEOUT_MS = 5 * 60_000

/**
 * `signal` is the caller giving up — the browser closing the connection behind
 * `POST /api/extract`. It is combined with the timeout rather than replacing
 * it, so cancelling actually reaches Anthropic and stops the generation being
 * billed for an answer nobody is going to read.
 *
 * Run Claude over `transcript` and return everything it found: the tasks, the
 * decisions, the risks and the open questions.
 *
 * Same contract as `extractWithOllama`: `transcript` is the body with the
 * frontmatter stripped, `meta` supplies the title, date and attendees, and four
 * empty lists mean the model found nothing — a valid answer.
 *
 * Throws `ExtractionError` when the key is missing or rejected, when Anthropic
 * refuses the request, or when the answer is not the JSON it was asked for.
 */
export async function extractWithClaude(
  transcript: string,
  meta: TranscriptMeta,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const key = apiKey.trim()
  if (!key) {
    throw new ExtractionError(
      'No hay ninguna API key de Anthropic guardada. Configúrala en /settings.',
    )
  }

  const request = {
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(transcript, meta) }],
    // Constrained decoding against the same schema Ollama gets in `format`.
    // Note there is deliberately no `temperature`/`top_p`/`top_k` here: current
    // models reject all three with a 400.
    output_config: {
      format: { type: 'json_schema', schema: TASKS_JSON_SCHEMA },
    },
  }

  let response: Response
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(request),
      signal: withTimeout(signal, EXTRACTION_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    throw new ExtractionError(
      `No se pudo conectar con la API de Anthropic para extraer con «${CLAUDE_MODEL}». Comprueba tu conexión a internet.`,
      err,
    )
  }

  if (response.status === 401) {
    throw new ExtractionError(
      'La API key de Anthropic no es válida. Revísala en /settings.',
    )
  }

  if (!response.ok) {
    // Only Anthropic knows whether this is a quota, a bad request or an
    // overload, so its own wording travels to the user, like Linear's does.
    const detail = await errorDetail(response)
    throw new ExtractionError(
      `Anthropic respondió ${response.status} al extraer con el modelo «${CLAUDE_MODEL}»${detail}.`,
    )
  }

  let envelope: unknown
  try {
    envelope = await response.json()
  } catch (err) {
    throw new ExtractionError(
      `Anthropic devolvió una respuesta ilegible al extraer con el modelo «${CLAUDE_MODEL}».`,
      err,
    )
  }

  // Checked before the content is touched: on a refusal `content` is empty or
  // holds a partial answer, and parsing it would report "no tasks" for a
  // transcript that was never read.
  const stopReason = stringField(envelope, 'stop_reason')
  if (stopReason === 'refusal') {
    throw new ExtractionError(
      `Anthropic rechazó la extracción de esta transcripción${refusalDetail(envelope)}.`,
    )
  }
  if (stopReason === 'max_tokens') {
    throw new ExtractionError(
      `La respuesta de «${CLAUDE_MODEL}» se cortó por longitud antes de completar el JSON. Prueba con una transcripción más corta.`,
    )
  }

  const content = textContent(envelope)
  if (content === null) {
    throw new ExtractionError(
      `Anthropic devolvió una respuesta vacía al extraer con el modelo «${CLAUDE_MODEL}».`,
    )
  }

  let payload: unknown
  try {
    payload = JSON.parse(content)
  } catch (err) {
    throw new ExtractionError(
      `El modelo «${CLAUDE_MODEL}» no devolvió JSON válido.`,
      err,
    )
  }

  return normalizeExtraction(payload)
}

/**
 * The JSON lives in the first `text` block. Anything else in `content` —
 * thinking blocks, which this model emits by default — is skipped rather than
 * indexed past, so the answer is found wherever it lands.
 */
function textContent(envelope: unknown): string | null {
  if (typeof envelope !== 'object' || envelope === null) return null
  const content = (envelope as { content?: unknown }).content
  if (!Array.isArray(content)) return null

  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const { type, text } = block as { type?: unknown; text?: unknown }
    if (type === 'text' && typeof text === 'string' && text.trim()) return text
  }
  return null
}

/** `stop_details` carries the policy category behind a refusal; it may be absent. */
function refusalDetail(envelope: unknown): string {
  if (typeof envelope !== 'object' || envelope === null) return ''
  const details = (envelope as { stop_details?: unknown }).stop_details
  if (typeof details !== 'object' || details === null) return ''
  const category = (details as { category?: unknown }).category
  return typeof category === 'string' && category.trim()
    ? ` (motivo: ${category.trim()})`
    : ''
}

/** Anthropic's own wording for a rejected request, as ` («…»)`. */
async function errorDetail(response: Response): Promise<string> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return ''
  }
  const message = stringField(
    (body as { error?: unknown } | null)?.error,
    'message',
  )
  return message ? ` («${message}»)` : ''
}

/** A trimmed string field, or `null` when it is missing or not a string. */
function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}
