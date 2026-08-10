/**
 * Talking to the Linear GraphQL API: the workspace lookup that backs the
 * «Probar» button and the teams/projects listing that fills the destination
 * picker. Issue creation joins them later.
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

/** A project as shown in the destination dropdown. */
export type LinearProject = {
  id: string
  name: string
}

/** A team with the projects that belong to it. */
export type LinearTeam = {
  id: string
  name: string
  key: string
  projects: LinearProject[]
}

/**
 * How many nodes one page asks for. Linear caps `first` at 250; staying well
 * under it keeps a workspace with hundreds of projects from timing out on the
 * single request that fills a dropdown.
 */
const TEAM_PAGE_SIZE = 50
const PROJECT_PAGE_SIZE = 100

/**
 * A broken or looping cursor must not spin forever: at these page sizes the cap
 * still covers 1000 teams and 2000 projects per team, far past any real workspace.
 */
const MAX_PAGES = 20

const TEAMS_QUERY = `query Teams($after: String) {
  teams(first: ${TEAM_PAGE_SIZE}, after: $after) {
    nodes {
      id
      name
      key
      projects(first: ${PROJECT_PAGE_SIZE}) {
        nodes { id name }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

const TEAM_PROJECTS_QUERY = `query TeamProjects($teamId: String!, $after: String) {
  team(id: $teamId) {
    projects(first: ${PROJECT_PAGE_SIZE}, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

/**
 * Every team the key can see, each with its projects. This is the whole
 * workspace structure the push panel needs: the user picks a team only when
 * there is more than one, and a project out of that team's list.
 *
 * Both connections are paginated — a workspace with more projects than one page
 * holds would otherwise silently lose the very project the user is looking for.
 */
export async function listTeamsAndProjects(apiKey: string): Promise<LinearTeam[]> {
  const parsed: ParsedTeam[] = []
  let after: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const body: unknown = await linearGraphQL(apiKey, TEAMS_QUERY, after ? { after } : {})
    const connection = readConnection(body, 'teams')
    if (!connection) {
      throw new LinearApiError(502, 'Linear respondió sin la lista de equipos.')
    }

    for (const node of connection.nodes) {
      const team = readTeam(node)
      if (team) parsed.push(team)
    }

    if (!connection.hasNextPage || !connection.endCursor) break
    after = connection.endCursor
  }

  // A team whose projects did not fit in one page finishes on its own query;
  // the common case (every team under the page size) makes no extra request.
  const teams: LinearTeam[] = []
  for (const { team, projectsCursor } of parsed) {
    if (projectsCursor) {
      team.projects.push(...(await restOfProjects(apiKey, team.id, projectsCursor)))
    }
    team.projects.sort(byName)
    teams.push(team)
  }
  teams.sort(byName)

  return teams
}

/**
 * A team as read off one page of the response, plus where its own project
 * pagination stopped — a cursor that never leaves this module.
 */
type ParsedTeam = {
  team: LinearTeam
  projectsCursor: string | null
}

/** The projects after `after`, following the cursor until Linear runs out. */
async function restOfProjects(
  apiKey: string,
  teamId: string,
  after: string,
): Promise<LinearProject[]> {
  const projects: LinearProject[] = []
  let cursor: string | null = after

  for (let page = 0; page < MAX_PAGES && cursor; page++) {
    const body: unknown = await linearGraphQL(apiKey, TEAM_PROJECTS_QUERY, { teamId, after: cursor })
    const team = isRecord(body) ? body.team : null
    const connection = readConnection(team, 'projects')
    if (!connection) break

    for (const node of connection.nodes) {
      const project = readProject(node)
      if (project) projects.push(project)
    }

    cursor = connection.hasNextPage ? connection.endCursor : null
  }

  return projects
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

/** A team node, or null when it is missing the fields the picker needs. */
function readTeam(node: unknown): ParsedTeam | null {
  if (!isRecord(node)) return null

  const { id, name, key } = node
  if (typeof id !== 'string' || !id) return null
  if (typeof name !== 'string' || !name) return null

  const connection = readConnection(node, 'projects')
  const projects: LinearProject[] = []
  for (const entry of connection?.nodes ?? []) {
    const project = readProject(entry)
    if (project) projects.push(project)
  }

  return {
    team: { id, name, key: typeof key === 'string' ? key : '', projects },
    projectsCursor: connection?.hasNextPage ? connection.endCursor : null,
  }
}

function readProject(node: unknown): LinearProject | null {
  if (!isRecord(node)) return null

  const { id, name } = node
  if (typeof id !== 'string' || !id) return null
  if (typeof name !== 'string' || !name) return null

  return { id, name }
}

/** A GraphQL Relay connection (`{ nodes, pageInfo }`) under `key`. */
function readConnection(
  parent: unknown,
  key: string,
): { nodes: unknown[]; hasNextPage: boolean; endCursor: string | null } | null {
  if (!isRecord(parent)) return null

  const connection = parent[key]
  if (!isRecord(connection)) return null

  const { nodes, pageInfo } = connection
  if (!Array.isArray(nodes)) return null

  const info = isRecord(pageInfo) ? pageInfo : {}
  const endCursor = typeof info.endCursor === 'string' && info.endCursor ? info.endCursor : null

  return { nodes, hasNextPage: info.hasNextPage === true && endCursor !== null, endCursor }
}

/** Dropdowns read better alphabetically, and the API's own order is unspecified. */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'es')
}

/** A trailing slash would make the request path double up. */
function normalizeUrl(input: string | undefined): string | null {
  const trimmed = input?.trim().replace(/\/+$/, '')
  return trimmed ? trimmed : null
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
