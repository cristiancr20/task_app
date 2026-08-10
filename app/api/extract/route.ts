import { errorResponse, HttpError, pathFromBody, requireContextRoot } from '@/lib/api'
import { extractWithClaude } from '@/lib/extractors/claude'
import { extractWithOllama } from '@/lib/extractors/ollama'
import type { ExtractedTask } from '@/lib/extractors/task'
import { getConfig } from '@/lib/store'
import { readTranscript, type TranscriptMeta } from '@/lib/transcripts'

/**
 * `POST /api/extract` with `{ path: string }` — runs the configured extractor
 * over one transcript and answers `{ tasks }`.
 *
 * The provider is read from the config store here rather than being sent by the
 * browser: which model runs, and with which key, is server state. The two
 * extractors share one type and one prompt (`lib/extractors/task.ts`), so the
 * answer does not depend on which one ran.
 *
 * A `POST` because the transcript path is input to a job that costs minutes and
 * money, and nothing here is cacheable.
 */
export async function POST(request: Request): Promise<Response> {
  let relPath = ''

  try {
    relPath = await pathFromBody(request)
    // Same guard as `/api/transcript`: the explorer only ever lists `.md`, so
    // anything else is a path the user never saw.
    if (!relPath.toLowerCase().endsWith('.md')) {
      throw new HttpError(400, `Solo se pueden leer archivos .md: ${relPath}`)
    }

    // `readTranscript` hands back the body with the frontmatter already
    // stripped — the attendee list and the date reach the model through `meta`,
    // not as YAML the model has to parse.
    const { meta, body } = readTranscript(requireContextRoot(), relPath)

    return Response.json({ tasks: await extract(body, meta) })
  } catch (err) {
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
async function extract(body: string, meta: TranscriptMeta): Promise<ExtractedTask[]> {
  const config = getConfig()

  if (config.provider === 'claude') {
    const apiKey = config.claudeApiKey.trim()
    if (!apiKey) {
      throw new HttpError(
        400,
        'No hay ninguna API key de Anthropic guardada. Configúrala en /settings.',
      )
    }
    return extractWithClaude(body, meta, apiKey)
  }

  const model = config.ollamaModel.trim()
  if (!model) {
    throw new HttpError(
      400,
      'No hay ningún modelo de Ollama seleccionado. Elige uno en /settings.',
    )
  }
  return extractWithOllama(body, meta, model)
}
