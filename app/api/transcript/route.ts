import { errorResponse, HttpError, pathParam, requireContextRoot } from '@/lib/api'
import { getHistory } from '@/lib/store'
import { readTranscript } from '@/lib/transcripts'

/**
 * `GET /api/transcript?path=<relPath>` — metadata plus the body of one note,
 * frontmatter stripped. `path` is root-relative and `/`-separated.
 *
 * The push history of that same file travels with it: the preview always shows
 * both, and the history is keyed by the very path being read, so splitting it
 * into a second route would only cost a second round trip.
 */
export async function GET(request: Request): Promise<Response> {
  const relPath = pathParam(request)

  try {
    if (!relPath) {
      throw new HttpError(400, 'Falta el parámetro ?path= con la ruta del archivo.')
    }
    // The explorer only ever lists `.md`, so reading anything else through this
    // route would expose files the user never saw.
    if (!relPath.toLowerCase().endsWith('.md')) {
      throw new HttpError(400, `Solo se pueden leer archivos .md: ${relPath}`)
    }

    const transcript = readTranscript(requireContextRoot(), relPath)
    return Response.json({ ...transcript, history: getHistory(relPath) })
  } catch (err) {
    return errorResponse(err, relPath)
  }
}
