import {
  errorResponse,
  HttpError,
  jsonBody,
  requireContextRoot,
  requireMarkdownPath,
} from '@/lib/api'
import { fetchIssueStates, type IssueState } from '@/lib/linear'
import { getConfig } from '@/lib/store'

/**
 * `POST /api/linear/folder-issue-states` with `{ paths }` — what became of the
 * issues a whole folder of notes already created, as
 * `{ states: { [path]: IssueState[] } }`.
 *
 * The list panel needs the same answer `/api/linear/issue-states` gives, but for
 * every row it is about to draw. One request per row would be a burst of round
 * trips — and, worse, a burst of Linear queries — for a panel that redraws every
 * time the user picks another folder, so the whole folder is asked for at once:
 * the ids of every note are collected here, deduplicated across notes, and sent
 * to Linear in the batches `fetchIssueStates` already paginates.
 *
 * As in the single-note route, only paths travel: the ids live in the push
 * history and the key in the config, both of them server state.
 *
 * A path with no history — or one Linear no longer knows anything about — comes
 * back as an empty list rather than being left out, so the browser can tell «no
 * hay nada que contar» from «no lo pregunté».
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const paths = requirePaths(await jsonBody(request))
    requireContextRoot()

    // Checked before the history is read, exactly like the single-note route:
    // «no key» is something to fix in /settings, not an empty report.
    const config = getConfig()
    const apiKey = config.linearApiKey.trim()
    if (!apiKey) {
      throw new HttpError(
        400,
        'No hay ninguna API key de Linear guardada. Guárdala en /settings.',
      )
    }

    // The config is read once for the whole folder — `getHistory` would re-read
    // and re-parse the file once per note.
    const idsByPath = new Map<string, string[]>()
    for (const relPath of paths) {
      const history = config.history[relPath] ?? []
      idsByPath.set(relPath, history.flatMap((push) => push.issues.map((issue) => issue.id)))
    }

    // One list for the whole folder: two notes that pushed the same issue ask
    // for it once, and `fetchIssueStates` answers nothing at all when the folder
    // has no history to report on.
    const reported = await fetchIssueStates(apiKey, [...idsByPath.values()].flat())
    const byId = new Map(reported.map((state) => [state.id, state]))

    const states: Record<string, IssueState[]> = {}
    for (const [relPath, ids] of idsByPath) {
      // An id Linear no longer knows simply does not come back; the note is then
      // reported on for fewer issues than it created, which is what it is.
      states[relPath] = ids.flatMap((id) => {
        const state = byId.get(id)
        return state ? [state] : []
      })
    }

    return Response.json({ states })
  } catch (err) {
    return errorResponse(err, '')
  }
}

/**
 * The `paths` field of an already-parsed body: the notes of one folder, each of
 * them a `.md` file, deduplicated. An empty list is a bad request rather than an
 * empty answer — the browser only asks about notes it has already listed.
 */
function requirePaths(payload: unknown): string[] {
  const paths =
    typeof payload === 'object' && payload !== null
      ? (payload as { paths?: unknown }).paths
      : undefined

  if (!Array.isArray(paths) || paths.length === 0) {
    throw new HttpError(400, 'Falta el campo «paths» con las rutas de los archivos.')
  }

  const clean = paths.map((path) => {
    if (typeof path !== 'string' || !path.trim()) {
      throw new HttpError(400, 'El campo «paths» solo puede contener rutas de archivos.')
    }
    return requireMarkdownPath(path.trim())
  })

  return [...new Set(clean)]
}
