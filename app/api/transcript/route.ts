import { errorResponse, HttpError, pathParam, requireContextRoot } from '@/lib/api'
import { readTranscript } from '@/lib/transcripts'

/**
 * `GET /api/transcript?path=<relPath>` — metadata plus the body of one note,
 * frontmatter stripped. `path` is root-relative and `/`-separated.
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

    return Response.json(readTranscript(requireContextRoot(), relPath))
  } catch (err) {
    return errorResponse(err, relPath)
  }
}
