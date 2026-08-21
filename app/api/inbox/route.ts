import { errorResponse, requireContextRoot } from '@/lib/api'
import { buildInbox, type InboxItem } from '@/lib/inbox'
import { getDraftedPaths } from '@/lib/drafts-store'
import { getPushedPaths } from '@/lib/store'
import { getTranscriptIndex, refreshTranscriptIndex } from '@/lib/transcript-index'

/**
 * `GET /api/inbox` — every note under the context root that has not been pushed
 * yet, most recent first.
 *
 * All three inputs are already owned by the server: the notes come from the
 * in-memory walk, the pushes from `config.json` and the drafts from
 * `drafts.json`. Nothing here reads a transcript body — the inbox is a list of
 * what is pending, not of what it says — so the whole answer costs one cached
 * walk and two small local files.
 *
 * `?refresh=1` is the reload button: it walks the disk again instead of serving
 * the index, which is how a note dropped into the folder a moment ago shows up
 * without waiting for the TTL.
 *
 * `truncated` travels because the walk has limits and reaching one means this
 * is not everything there is. A short list that looks complete is the one
 * failure an inbox must not have.
 */
export async function GET(request: Request): Promise<Response> {
  const refresh = new URL(request.url).searchParams.get('refresh') === '1'

  try {
    const root = requireContextRoot()
    const index = refresh ? await refreshTranscriptIndex(root) : await getTranscriptIndex(root)

    const items: InboxItem[] = buildInbox({
      files: index.files,
      pushed: getPushedPaths(),
      drafted: getDraftedPaths(),
    })

    return Response.json({
      items,
      truncated: index.truncated,
      /** Notes walked, so the view can say «12 de 340» rather than just «12». */
      scanned: index.files.length,
    })
  } catch (err) {
    // Nothing here is about one file, so failures are worded against the root.
    return errorResponse(err, '')
  }
}
