import { errorResponse, HttpError } from '@/lib/api'
import { listTeamsAndProjects } from '@/lib/linear'
import { getConfig } from '@/lib/store'

/**
 * `GET /api/linear/projects` — the workspace structure behind the stored Linear
 * API key: every team the key can see with its projects, for the destination
 * picker. Like `/api/linear/verify`, the key is read server-side and never
 * travels in a URL, a query string or a body.
 */
export async function GET(): Promise<Response> {
  try {
    const apiKey = getConfig().linearApiKey.trim()
    if (!apiKey) {
      throw new HttpError(
        400,
        'No hay ninguna API key de Linear guardada. Guárdala en /settings.',
      )
    }

    return Response.json({ teams: await listTeamsAndProjects(apiKey) })
  } catch (err) {
    return errorResponse(err, '')
  }
}
