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

/** Turn anything the store or the scanner throws into a JSON error response. */
export function errorResponse(err: unknown, relPath: string): Response {
  const { status, message } = describeError(err, relPath)
  return jsonError(status, message)
}

/**
 * Map anything the store or the scanner throws to a status and a Spanish
 * message. Route handlers reach it through `errorResponse`; server actions,
 * which answer with state rather than a `Response`, use the message directly.
 *
 * The scanner deliberately does not translate `fs` failures, so the mapping
 * from errno lives here: bad input from the browser answers 4xx, anything
 * unrecognised answers 500 and gets logged.
 */
export function describeError(
  err: unknown,
  relPath: string,
): { status: number; message: string } {
  if (err instanceof HttpError) return { status: err.status, message: err.message }

  if (err instanceof PathEscapesRootError) {
    return { status: 400, message: `La ruta sale de la carpeta de contexto: ${label(relPath)}` }
  }

  switch (errnoCode(err)) {
    case 'ENOENT':
      return { status: 404, message: `No existe: ${label(relPath)}` }
    case 'ENOTDIR':
      return { status: 400, message: `No es una carpeta: ${label(relPath)}` }
    case 'EISDIR':
      return { status: 400, message: `Es una carpeta, no un archivo: ${label(relPath)}` }
    case 'ENAMETOOLONG':
      return { status: 400, message: 'La ruta es demasiado larga.' }
    case 'EACCES':
    case 'EPERM':
      return { status: 403, message: `Sin permisos para leer: ${label(relPath)}` }
  }

  console.error('Error inesperado al leer la carpeta de contexto:', err)
  return { status: 500, message: 'Error inesperado al leer la carpeta de contexto.' }
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
