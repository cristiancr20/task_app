import { errorResponse, pathParam, requireContextRoot } from '@/lib/api'
import { listFolder } from '@/lib/transcripts'

/**
 * `GET /api/browse?path=<relPath>` — one folder level under the context root.
 * `path` is root-relative and `/`-separated; omit it for the root itself.
 */
export async function GET(request: Request): Promise<Response> {
  const relPath = pathParam(request)

  try {
    return Response.json(listFolder(requireContextRoot(), relPath))
  } catch (err) {
    return errorResponse(err, relPath)
  }
}
