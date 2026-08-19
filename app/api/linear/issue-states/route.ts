import {
  errorResponse,
  HttpError,
  pathFromBody,
  requireContextRoot,
  requireMarkdownPath,
} from '@/lib/api'
import { fetchIssueStates } from '@/lib/linear'
import { getConfig, getHistory } from '@/lib/store'

/**
 * `POST /api/linear/issue-states` with `{ path }` — what became of the issues
 * one note already created, as `{ states }`.
 *
 * The browser sends the path of the note and nothing else: the ids live in the
 * push history, which is server state, and the API key never leaves the server
 * either — same rule as `/api/linear/push`, which is where those ids were
 * written in the first place. A route that took the ids from the browser would
 * happily report on issues this note never produced.
 *
 * A `POST` rather than a `GET` because it is what every other route that takes
 * a note path in a body does, and because reading it is a round trip to Linear
 * that must never be served from a cache.
 *
 * `requireContextRoot` is called even though nothing here reads the filesystem,
 * for the same reason `/api/drafts` calls it: the history is keyed by a path
 * relative to that root, so answering without one would report on whatever
 * folder was configured when the push happened.
 */
export async function POST(request: Request): Promise<Response> {
  let relPath = ''

  try {
    relPath = requireMarkdownPath(await pathFromBody(request))
    requireContextRoot()

    // The key is checked before the history is even read: «no key» is a thing
    // the user has to fix in /settings, and saying so is more useful than an
    // empty answer that looks like «nothing to report».
    const apiKey = getConfig().linearApiKey.trim()
    if (!apiKey) {
      throw new HttpError(
        400,
        'No hay ninguna API key de Linear guardada. Guárdala en /settings.',
      )
    }

    // A note that was never pushed has no ids, so there is nothing to ask about
    // — `fetchIssueStates` answers `[]` without a request, and the caller gets
    // an empty report rather than an error it would have to special-case.
    const ids = getHistory(relPath).flatMap((entry) => entry.issues.map((issue) => issue.id))

    return Response.json({ states: await fetchIssueStates(apiKey, ids) })
  } catch (err) {
    return errorResponse(err, relPath)
  }
}
