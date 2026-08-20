import { errorResponse, HttpError, requireContextRoot } from '@/lib/api'
import {
  MAX_SEARCH_FILES,
  MAX_SEARCH_RESULTS,
  MIN_QUERY_LENGTH,
  prepareQuery,
  searchNote,
  sortResults,
  type SearchResult,
} from '@/lib/search'
import { getTranscriptIndex } from '@/lib/transcript-index'
import { readTranscript } from '@/lib/transcripts'

/**
 * `GET /api/search?q=<phrase>` — every note under the context root that says
 * the phrase, with the excerpts around it.
 *
 * The metadata comes from the in-memory index, so a search does not re-walk
 * the folder; the bodies do not, because the index deliberately does not hold
 * them. They are read one at a time, here, and only for the notes this request
 * is going to look at.
 *
 * Both ends of the work are bounded and both are reported: at most
 * `MAX_SEARCH_FILES` notes are opened and at most `MAX_SEARCH_RESULTS` come
 * back, and `truncated` is set whenever a limit — this route's, or the walk's
 * own — kept the answer from being everything there is.
 */
export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('q') ?? ''

  try {
    const prepared = prepareQuery(raw)
    if (!prepared.ok) {
      throw new HttpError(
        400,
        `Escribe al menos ${MIN_QUERY_LENGTH} caracteres para buscar.`,
      )
    }

    const root = requireContextRoot()
    const index = await getTranscriptIndex(root)

    // The index is sorted date descending, so cutting the tail keeps the
    // recent notes — the ones a search is nearly always about.
    const notes = index.files.slice(0, MAX_SEARCH_FILES)
    const results: SearchResult[] = []

    for (const meta of notes) {
      let body: string
      try {
        // Through `readTranscript` rather than reading the file here: it is
        // the call that re-checks the path against the root and that knows how
        // to split the frontmatter off. It re-derives the metadata this loop
        // already has, which is the price of not owning a second parser.
        body = readTranscript(root, meta.relPath).body
      } catch {
        // A note that vanished or turned unreadable since the walk: leave it
        // out, exactly as the walk itself would have.
        continue
      }

      const result = searchNote(prepared.query, meta, body)
      if (result) results.push(result)
    }

    const sorted = sortResults(results)

    return Response.json({
      results: sorted.slice(0, MAX_SEARCH_RESULTS),
      truncated:
        index.truncated || notes.length < index.files.length || sorted.length > MAX_SEARCH_RESULTS,
    })
  } catch (err) {
    // Nothing here is about one file, so failures are worded against the root.
    return errorResponse(err, '')
  }
}
