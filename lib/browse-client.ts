import type { PushSummary } from './store'
import type { FolderListing, TranscriptMeta } from './transcripts'

/** One `.md` row of a listing, plus what has already been created from it. */
export type FileView = TranscriptMeta & {
  /** Null when the note was never pushed — the row shows no badge. */
  pushed: PushSummary | null
}

/** What `GET /api/browse` answers: one folder level, with its files marked. */
export type FolderView = Omit<FolderListing, 'files'> & { files: FileView[] }

/**
 * `GET /api/browse` as seen from the browser.
 *
 * The route already answers Spanish messages for everything it knows about
 * (no context root, path outside it, missing folder, no permissions), so a
 * failure travels as an `Error` carrying that text verbatim and the UI can
 * render `err.message` without a second mapping.
 *
 * This is a browser-only helper: it borrows the listing *type* from
 * `lib/transcripts.ts` — a type-only import, so the node-only scanner never
 * reaches the client bundle.
 */
export async function fetchFolder(relPath: string): Promise<FolderView> {
  let response: Response
  try {
    response = await fetch(`/api/browse?path=${encodeURIComponent(relPath)}`, {
      cache: 'no-store',
    })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la aplicación.')
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) throw new Error(errorMessage(body))
  if (!isListing(body)) throw new Error('El servidor devolvió una respuesta inesperada.')

  return body
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudo leer la carpeta.'
}

function isListing(body: unknown): body is FolderView {
  if (typeof body !== 'object' || body === null) return false
  const { folders, files } = body as { folders?: unknown; files?: unknown }
  return Array.isArray(folders) && Array.isArray(files)
}
