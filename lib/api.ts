import { getConfig } from './store'
import { PathEscapesRootError } from './transcripts'

/** An error that already knows which HTTP status it deserves. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * The configured context root, or a 400 — every route under `/api` that touches
 * the filesystem is meaningless without one.
 */
export function requireContextRoot(): string {
  const root = getConfig().contextRoot?.trim()
  if (!root) {
    throw new HttpError(
      400,
      'No hay carpeta de contexto configurada. Configúrala en /settings.',
    )
  }
  return root
}

/** The `?path=` query parameter, root-relative; `''` means the root itself. */
export function pathParam(request: Request): string {
  return new URL(request.url).searchParams.get('path')?.trim() ?? ''
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

/**
 * Turn anything the store or the scanner throws into a JSON error response.
 *
 * The scanner deliberately does not translate `fs` failures, so the mapping
 * from errno to status code lives here: bad input from the browser answers 4xx,
 * anything unrecognised answers 500 and gets logged.
 */
export function errorResponse(err: unknown, relPath: string): Response {
  if (err instanceof HttpError) return jsonError(err.status, err.message)

  if (err instanceof PathEscapesRootError) {
    return jsonError(400, `La ruta sale de la carpeta de contexto: ${label(relPath)}`)
  }

  switch (errnoCode(err)) {
    case 'ENOENT':
      return jsonError(404, `No existe: ${label(relPath)}`)
    case 'ENOTDIR':
      return jsonError(400, `No es una carpeta: ${label(relPath)}`)
    case 'EISDIR':
      return jsonError(400, `Es una carpeta, no un archivo: ${label(relPath)}`)
    case 'ENAMETOOLONG':
      return jsonError(400, 'La ruta es demasiado larga.')
    case 'EACCES':
    case 'EPERM':
      return jsonError(403, `Sin permisos para leer: ${label(relPath)}`)
  }

  console.error('Error inesperado al leer la carpeta de contexto:', err)
  return jsonError(500, 'Error inesperado al leer la carpeta de contexto.')
}

/** `''` is the root, which has no name to show. */
function label(relPath: string): string {
  return relPath || 'la carpeta raíz'
}

function errnoCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}
