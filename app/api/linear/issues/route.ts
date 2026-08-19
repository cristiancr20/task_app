import { errorResponse, HttpError } from '@/lib/api'
import { listIssuesForDuplicateCheck } from '@/lib/linear'
import { getConfig } from '@/lib/store'

/**
 * `GET /api/linear/issues?teamId=…&projectId=…` — the issues that already live
 * in the destination the push is aimed at, for the duplicate check. Like
 * `/api/linear/verify` and `/api/linear/projects`, the key is read server-side
 * and never travels in a URL, a query string or a body.
 *
 * `projectId` is optional: without one the destination is the whole team, which
 * is exactly the scope `listIssuesForDuplicateCheck` then searches.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams
    const teamId = params.get('teamId')?.trim() ?? ''
    if (!teamId) {
      throw new HttpError(400, 'Falta el parámetro «teamId» con el equipo de Linear.')
    }

    const apiKey = getConfig().linearApiKey.trim()
    if (!apiKey) {
      throw new HttpError(
        400,
        'No hay ninguna API key de Linear guardada. Guárdala en /settings.',
      )
    }

    const projectId = params.get('projectId')?.trim() ?? ''
    const issues = await listIssuesForDuplicateCheck(apiKey, { teamId, projectId })

    return Response.json({ issues })
  } catch (err) {
    return errorResponse(err, '')
  }
}
