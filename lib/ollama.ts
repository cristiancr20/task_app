/**
 * Talking to a local Ollama server: where it lives and which models it has.
 * The extraction call is `lib/extractors/ollama.ts`, which reads `OLLAMA_URL`
 * from here.
 */

/** The model the app suggests and preselects when it is installed. */
export const DEFAULT_OLLAMA_MODEL = 'qwen3:8b'

/**
 * Where Ollama listens. `127.0.0.1` rather than `localhost` on purpose: Node
 * may resolve `localhost` to `::1` first, and Ollama binds IPv4 by default.
 */
export const OLLAMA_URL = normalizeUrl(process.env.OLLAMA_URL) ?? 'http://127.0.0.1:11434'

/** Ollama is local, so a slow answer means it is not really there. */
const TAGS_TIMEOUT_MS = 3000

/** Ollama did not answer, or answered with something that is not a model list. */
export class OllamaUnreachableError extends Error {
  constructor(
    readonly url: string,
    readonly cause?: unknown,
  ) {
    super(`No se pudo conectar con Ollama en ${url}`)
    this.name = 'OllamaUnreachableError'
  }
}

/**
 * The models installed on the local server, sorted by name. An empty array
 * means Ollama answered but has nothing pulled yet — a different situation
 * from `OllamaUnreachableError`, which is what this throws when it is down.
 */
export async function listOllamaModels(): Promise<string[]> {
  let response: Response
  try {
    response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
      // The list changes whenever the user pulls a model; never cache it.
      cache: 'no-store',
    })
  } catch (err) {
    throw new OllamaUnreachableError(OLLAMA_URL, err)
  }

  if (!response.ok) {
    throw new OllamaUnreachableError(OLLAMA_URL, new Error(`HTTP ${response.status}`))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (err) {
    throw new OllamaUnreachableError(OLLAMA_URL, err)
  }

  return modelNames(body)
}

/** `/api/tags` answers `{ models: [{ name, model, size, … }] }`. */
function modelNames(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return []
  const models = (body as { models?: unknown }).models
  if (!Array.isArray(models)) return []

  const names = models
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return null
      const { name, model } = entry as { name?: unknown; model?: unknown }
      if (typeof name === 'string' && name) return name
      if (typeof model === 'string' && model) return model
      return null
    })
    .filter((name): name is string => name !== null)

  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

/** A trailing slash would make every request path double up. */
function normalizeUrl(input: string | undefined): string | null {
  const trimmed = input?.trim().replace(/\/+$/, '')
  return trimmed ? trimmed : null
}
