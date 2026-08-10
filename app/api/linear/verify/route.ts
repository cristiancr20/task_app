import { errorResponse, HttpError } from '@/lib/api'
import { fetchLinearOrganization } from '@/lib/linear'
import { getConfig } from '@/lib/store'

/**
 * `GET /api/linear/verify` — checks the stored Linear API key by asking Linear
 * which workspace it belongs to. The key itself never leaves the server: the
 * browser only sends the request and reads back the workspace name.
 */
export async function GET(): Promise<Response> {
  try {
    const apiKey = getConfig().linearApiKey.trim()
    if (!apiKey) {
      throw new HttpError(
        400,
        'No hay ninguna API key de Linear guardada. Guárdala y vuelve a probar.',
      )
    }

    return Response.json({ organization: await fetchLinearOrganization(apiKey) })
  } catch (err) {
    return errorResponse(err, '')
  }
}
