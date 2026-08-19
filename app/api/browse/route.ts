import { errorResponse, pathParam, requireContextRoot } from '@/lib/api'
import { getPushSummaries } from '@/lib/store'
import { listFolder } from '@/lib/transcripts'

/**
 * `GET /api/browse?path=<relPath>` — one folder level under the context root.
 * `path` is root-relative and `/`-separated; omit it for the root itself.
 *
 * Each file carries what has already been created from it, the same way
 * `/api/transcript` carries the full history: the list marks the notes that are
 * done, and knowing that before opening one is the whole point of the mark.
 */
export async function GET(request: Request): Promise<Response> {
  const relPath = pathParam(request)

  try {
    const listing = listFolder(requireContextRoot(), relPath)
    const summaries = getPushSummaries()

    return Response.json({
      ...listing,
      files: listing.files.map((file) => ({
        ...file,
        pushed: summaries[file.relPath] ?? null,
      })),
    })
  } catch (err) {
    return errorResponse(err, relPath)
  }
}
