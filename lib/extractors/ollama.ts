/**
 * Extraction through a local Ollama model.
 *
 * `lib/ollama.ts` owns where the server lives and which models it has; this
 * module owns the one call that turns a transcript into an `ExtractionResult`.
 * The shape of the answer, the prompts and the cleanup are shared with the
 * Claude extractor in `./task`.
 */

import { OLLAMA_URL } from '../ollama'
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

/**
 * Context window for the request. Ollama defaults to a few thousand tokens and
 * silently drops whatever does not fit — the model then answers confidently
 * about the half of the meeting it saw. 32768 covers a long transcript plus
 * the prompt; a bigger file grows the window rather than losing its tail.
 */
const MIN_NUM_CTX = 32768

/** Beyond this a local model is out of memory, not out of context. */
const MAX_NUM_CTX = 131072

/** Room for the system prompt, the header and the JSON coming back. */
const OVERHEAD_TOKENS = 4096

/**
 * A local model on CPU can spend minutes on a long transcript, so unlike the
 * model list this one gets a long leash. It still needs a bound: without it a
 * wedged server hangs the request until the browser gives up.
 */
const EXTRACTION_TIMEOUT_MS = 10 * 60_000

/**
 * Run `model` over `transcript` and return everything it found: the tasks, the
 * decisions, the risks and the open questions.
 *
 * `transcript` is the body with the frontmatter already stripped (what
 * `readTranscript` returns); `meta` supplies the title, date and attendees the
 * model needs to read it. Four empty lists mean the model found nothing, which
 * is a valid answer for a transcript that contains nothing.
 *
 * Throws `ExtractionError` when Ollama refuses the request or answers with
 * something that is not the JSON it was asked for.
 *
 * `signal` is the caller giving up — the browser closing the connection behind
 * `POST /api/extract`. It is combined with the timeout rather than replacing
 * it, so cancelling actually reaches Ollama and it stops generating: a local
 * model left running has the user's whole machine, and the next extraction
 * would queue behind the one nobody is waiting for any more.
 */
export async function extractWithOllama(
  transcript: string,
  meta: TranscriptMeta,
  model: string,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const name = model.trim()
  if (!name) {
    throw new ExtractionError('No hay ningún modelo de Ollama seleccionado. Elige uno en /settings.')
  }

  const request = {
    model: name,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(transcript, meta) },
    ],
    // Constrained decoding: the answer is forced to match the schema instead of
    // being asked politely for JSON and parsed hopefully.
    format: TASKS_JSON_SCHEMA,
    // Reasoning models otherwise spend the whole context thinking out loud and
    // wrap the JSON in the thinking block.
    think: false,
    stream: false,
    options: {
      num_ctx: contextSize(meta.approxTokens),
      // Extraction is a transcription job, not a creative one; the same
      // transcript should give the same tasks twice in a row.
      temperature: 0,
    },
  }

  let response: Response
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: withTimeout(signal, EXTRACTION_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    throw new ExtractionError(
      `No se pudo conectar con Ollama en ${OLLAMA_URL} para extraer con «${name}». Comprueba que está en marcha.`,
      err,
    )
  }

  if (!response.ok) {
    // Ollama explains itself in `{ error }`, and its most common failure here —
    // the model is not pulled — is only actionable if the user reads it.
    const detail = await errorDetail(response)
    throw new ExtractionError(
      `Ollama respondió ${response.status} al extraer con el modelo «${name}»${detail}.`,
    )
  }

  let envelope: unknown
  try {
    envelope = await response.json()
  } catch (err) {
    throw new ExtractionError(
      `Ollama devolvió una respuesta ilegible al extraer con el modelo «${name}».`,
      err,
    )
  }

  const content = messageContent(envelope)
  if (content === null) {
    throw new ExtractionError(
      `Ollama devolvió una respuesta vacía al extraer con el modelo «${name}». Prueba con otro modelo.`,
    )
  }

  let payload: unknown
  try {
    payload = JSON.parse(content)
  } catch (err) {
    throw new ExtractionError(
      `El modelo «${name}» de Ollama no devolvió JSON válido. Prueba con otro modelo.`,
      err,
    )
  }

  return normalizeExtraction(payload)
}

/**
 * The window this transcript needs, never below `MIN_NUM_CTX`. `approxTokens`
 * is the scanner's estimate, so it is padded before being trusted and rounded
 * up to a power of two — the sizes model runners are happiest with.
 */
function contextSize(approxTokens: number): number {
  const needed = Math.ceil(approxTokens * 1.5) + OVERHEAD_TOKENS
  let size = MIN_NUM_CTX
  while (size < needed && size < MAX_NUM_CTX) size *= 2
  return Math.min(size, MAX_NUM_CTX)
}

/** `/api/chat` answers `{ message: { role, content } }`. */
function messageContent(envelope: unknown): string | null {
  if (typeof envelope !== 'object' || envelope === null) return null
  const message = (envelope as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  if (typeof content !== 'string' || !content.trim()) return null
  return content
}

/** Ollama's own wording for a rejected request, as ` («…»)`; empty when it said nothing. */
async function errorDetail(response: Response): Promise<string> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return ''
  }
  if (typeof body !== 'object' || body === null) return ''
  const error = (body as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? ` («${error.trim()}»)` : ''
}
