import { errorResponse, jsonBody, requireContextRoot, requirePaths } from '@/lib/api'
import { getConfig, type HistoryEntry } from '@/lib/store'

/**
 * `POST /api/history` with `{ paths }` — the push history of a whole folder of
 * notes, as `{ history: { [path]: HistoryEntry[] } }`.
 *
 * `GET /api/transcript` already carries the history of the note being read, and
 * that is enough for every panel that is about *that* note. The
 * pending-commitments panel is not: it asks what the *other* meetings of this
 * project left open, which is a question about entries the browser has never
 * been sent — their project, their issues and when they were pushed all live in
 * `config.json`.
 *
 * It is a route of its own rather than a field of the folder's issue states
 * because the two answers are needed under different conditions: the history is
 * a local file read that works with no Linear key at all, and folding it into
 * the query that does need one would make the panel's own data depend on the
 * key check of a different question.
 *
 * No key is asked for and nothing is fetched: unlike its Linear counterpart this
 * route only reads the config the app already owns, once for the whole folder —
 * `getHistory` would re-read and re-parse the file per note.
 *
 * A path with no history comes back as an empty list rather than being left out,
 * so the browser can tell «esta nota no ha producido nada» from «no lo
 * pregunté», exactly as `/api/linear/folder-issue-states` does.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const paths = requirePaths(await jsonBody(request))
    requireContextRoot()

    const config = getConfig()
    const history: Record<string, HistoryEntry[]> = {}
    for (const relPath of paths) {
      history[relPath] = config.history[relPath] ?? []
    }

    return Response.json({ history })
  } catch (err) {
    return errorResponse(err, '')
  }
}
