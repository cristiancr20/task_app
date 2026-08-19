import {
  errorResponse,
  HttpError,
  jsonBody,
  pathOf,
  pathParam,
  requireContextRoot,
  requireMarkdownPath,
} from '@/lib/api'
import { getDrafts, normalizeState, saveDrafts } from '@/lib/drafts-store'

/**
 * `GET /api/drafts?path=<relPath>` — the stored drafts of one note, as
 * `{ rows, baseline, extracted }`. `path` is root-relative and `/`-separated.
 *
 * A note that was never curated answers an empty state rather than a 404: «no
 * drafts yet» is the normal case, not a failure, and the table renders it the
 * same way it renders a fresh file.
 *
 * `requireContextRoot` is called even though nothing here reads the filesystem:
 * the drafts are keyed by a path relative to that root, so answering without
 * one would hand back rows belonging to whichever folder was configured when
 * they were saved.
 */
export async function GET(request: Request): Promise<Response> {
  const relPath = pathParam(request)

  try {
    if (!relPath) {
      throw new HttpError(400, 'Falta el parámetro ?path= con la ruta del archivo.')
    }
    requireContextRoot()

    return Response.json(getDrafts(requireMarkdownPath(relPath)))
  } catch (err) {
    return errorResponse(err, relPath)
  }
}

/**
 * `PUT /api/drafts` with `{ path, rows, baseline, extracted }` — replaces the
 * drafts of that note and answers what was stored.
 *
 * A `PUT` because it is idempotent and total: the body carries the whole table,
 * not a patch, so the last write of a burst of edits is the one that counts.
 *
 * The body is normalised by the store itself, so a row the browser sends half
 * built is sieved exactly like one already on disk.
 */
export async function PUT(request: Request): Promise<Response> {
  let relPath = ''

  try {
    const payload = await jsonBody(request)
    relPath = requireMarkdownPath(pathOf(payload))
    requireContextRoot()

    return Response.json(saveDrafts(relPath, normalizeState(payload)))
  } catch (err) {
    return errorResponse(err, relPath)
  }
}
