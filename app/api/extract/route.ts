import {
  errorResponse,
  HttpError,
  pathFromBody,
  requireContextRoot,
  requireMarkdownPath,
} from '@/lib/api'
import { extractWithClaude } from '@/lib/extractors/claude'
import { extractWithOllama } from '@/lib/extractors/ollama'
import type { ExtractionResult } from '@/lib/extractors/task'
import { getConfig } from '@/lib/store'
import { readTranscript, type TranscriptMeta } from '@/lib/transcripts'

/**
 * `POST /api/extract` with `{ path: string }` — runs the configured extractor
 * over one transcript and answers `{ tasks, decisions, risks, openQuestions }`.
 *
 * The four lists are spread at the top level rather than nested under a new
 * key, so `tasks` stays exactly where it was: a client that only reads the
 * tasks — `lib/extract-client.ts` does — is unaffected by the other three.
 *
 * The provider is read from the config store here rather than being sent by the
 * browser: which model runs, and with which key, is server state. The two
 * extractors share one type and one prompt (`lib/extractors/task.ts`), so the
 * answer does not depend on which one ran.
 *
 * A `POST` because the transcript path is input to a job that costs minutes and
 * money, and nothing here is cacheable.
 *
 * The request's own signal travels all the way down to the provider, so
 * «Cancelar» in the table is not just the browser looking away: it stops the
 * model. That is what makes cancelling worth having with a local Ollama, where
 * an abandoned extraction otherwise keeps the machine busy for minutes.
 */
export async function POST(request: Request): Promise<Response> {
  let relPath = ''

  try {
    relPath = requireMarkdownPath(await pathFromBody(request))

    // `readTranscript` hands back the body with the frontmatter already
    // stripped — the attendee list and the date reach the model through `meta`,
    // not as YAML the model has to parse.
    const { meta, body } = readTranscript(requireContextRoot(), relPath)

    return Response.json(await extract(body, meta, request.signal))
  } catch (err) {
    // The browser hung up: it pressed «Cancelar», and the failure the extractor
    // reported is about a connection that no longer exists. Nothing reads this
    // response, so it says only what happened and never dresses a cancellation
    // up as «Ollama no responde» in the log.
    if (request.signal.aborted) return new Response(null, { status: 499 })
    return errorResponse(err, relPath)
  }
}

/**
 * Dispatch to the provider the config names.
 *
 * Missing configuration answers 400, not 502: no request ever left this
 * machine, so the failure is ours and the user fixes it in /settings. Anything
 * the provider itself refuses arrives as an `ExtractionError`, which
 * `describeError` already maps to 502 with the provider's own wording.
 */
async function extract(
  body: string,
  meta: TranscriptMeta,
  signal: AbortSignal,
): Promise<ExtractionResult> {
  const config = getConfig()

  if (config.provider === 'claude') {
    const apiKey = config.claudeApiKey.trim()
    if (!apiKey) {
      throw new HttpError(
        400,
        'No hay ninguna API key de Anthropic guardada. Configúrala en /settings.',
      )
    }
    return extractWithClaude(body, meta, apiKey, signal)
  }

  const model = config.ollamaModel.trim()
  if (!model) {
    throw new HttpError(
      400,
      'No hay ningún modelo de Ollama seleccionado. Elige uno en /settings.',
    )
  }
  return extractWithOllama(body, meta, model, signal)
}
