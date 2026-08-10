/**
 * Talking to the Linear GraphQL API. Only the workspace lookup that backs the
 * «Probar» button lives here for now; issue creation (US-013) joins it later.
 */

/**
 * Where Linear's GraphQL endpoint lives. `LINEAR_API_URL` overrides it, which
 * is how the app can be pointed at a stub while testing.
 */
export const LINEAR_API_URL =
  normalizeUrl(process.env.LINEAR_API_URL) ?? 'https://api.linear.app/graphql'

/** Linear is a remote API over the internet, so it gets a far longer leash than Ollama. */
const REQUEST_TIMEOUT_MS = 15_000

/** The network never reached Linear: DNS, TLS, offline, timeout. */
export class LinearUnreachableError extends Error {
  constructor(readonly cause?: unknown) {
    super(`No se pudo conectar con Linear en ${LINEAR_API_URL}`)
    this.name = 'LinearUnreachableError'
  }
}

/**
 * Linear answered and rejected the request. `message` is what Linear itself
 * said (in English) so the user can act on it; `status` is what our own routes
 * should answer.
 */
export class LinearApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'LinearApiError'
  }
}

/** The workspace a key belongs to, as shown next to the «Probar» button. */
export type LinearOrganization = {
  id: string
  name: string
  urlKey: string
}

const ORGANIZATION_QUERY = `query { organization { id name urlKey } }`

/**
 * The workspace behind `apiKey`. Doubles as the key check: a personal API key
 * that cannot read its own organization cannot create issues either.
 */
export async function fetchLinearOrganization(apiKey: string): Promise<LinearOrganization> {
  const body = await linearGraphQL(apiKey, ORGANIZATION_QUERY)

  const organization = readOrganization(body)
  if (!organization) {
    throw new LinearApiError(502, 'Linear respondió sin datos de la organización.')
  }
  return organization
}

/**
 * One GraphQL request against Linear, returning the parsed `data` payload.
 * Personal API keys go in `Authorization` verbatim — unlike OAuth tokens they
 * carry no `Bearer` prefix.
 */
export async function linearGraphQL(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const key = apiKey.trim()
  if (!key) throw new LinearApiError(401, 'Falta la API key de Linear.')

  let response: Response
  try {
    response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: key },
      body: JSON.stringify(variables ? { query, variables } : { query }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    throw new LinearUnreachableError(err)
  }

  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    // A non-JSON body (an HTML error page, say) leaves the HTTP status as the
    // only thing worth reporting; `graphqlError` then finds nothing.
  }

  // GraphQL reports failures in the body, and Linear pairs them with a 4xx for
  // auth problems but a 200 for others — so the body is checked first either way.
  const failure = graphqlError(parsed)
  if (failure) throw new LinearApiError(statusFor(response.status), `Linear: ${failure}`)
  if (!response.ok) {
    throw new LinearApiError(
      statusFor(response.status),
      `Linear respondió HTTP ${response.status}.`,
    )
  }

  return data(parsed)
}

/**
 * What our own route answers for a rejection by Linear. Linear replies 400 to
 * an invalid or missing key just as often as 401, so the whole auth range
 * collapses into 401; anything else is an upstream failure, not the user's.
 */
function statusFor(upstream: number): number {
  return upstream === 400 || upstream === 401 || upstream === 403 ? 401 : 502
}

/** The first message out of `{ errors: [{ message }] }`, or null. */
function graphqlError(body: unknown): string | null {
  if (!isRecord(body)) return null
  const errors = body.errors
  if (!Array.isArray(errors)) return null

  for (const entry of errors) {
    if (!isRecord(entry)) continue
    const { message } = entry
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return null
}

function data(body: unknown): unknown {
  return isRecord(body) ? body.data : null
}

function readOrganization(body: unknown): LinearOrganization | null {
  if (!isRecord(body)) return null
  const organization = body.organization
  if (!isRecord(organization)) return null

  const { id, name, urlKey } = organization
  if (typeof name !== 'string' || !name) return null

  return {
    id: typeof id === 'string' ? id : '',
    name,
    urlKey: typeof urlKey === 'string' ? urlKey : '',
  }
}

/** A trailing slash would make the request path double up. */
function normalizeUrl(input: string | undefined): string | null {
  const trimmed = input?.trim().replace(/\/+$/, '')
  return trimmed ? trimmed : null
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
