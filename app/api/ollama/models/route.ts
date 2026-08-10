import { errorResponse } from '@/lib/api'
import { listOllamaModels, OLLAMA_URL } from '@/lib/ollama'

/**
 * `GET /api/ollama/models` — the models installed on the local Ollama server.
 * The settings page asks for them from the browser so the page renders even
 * when Ollama is down, and can retry without a reload.
 */
export async function GET(): Promise<Response> {
  try {
    return Response.json({ url: OLLAMA_URL, models: await listOllamaModels() })
  } catch (err) {
    return errorResponse(err, '')
  }
}
