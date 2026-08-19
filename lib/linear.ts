/**
 * Talking to the Linear GraphQL API: the workspace lookup that backs the
 * «Probar» button, the teams/projects listing that fills the destination
 * picker, and the issue creation the push runs on.
 */

import type { Priority } from './extractors/task'

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
 * How many nodes one page asks for.
 *
 * Linear scores query complexity multiplicatively across nested connections and
 * rejects anything over its budget with "Query too complex" — and TEAMS_QUERY
 * asks for `pageInfo` inside the nested `projects` connection, which is what
 * tips it over. Measured against the real API: 50x100 is rejected, 25x50 passes.
 * Do not raise these without re-testing the actual query, not a simplified one.
 */
const TEAM_PAGE_SIZE = 25
const PROJECT_PAGE_SIZE = 50

/**
 * A broken or looping cursor must not spin forever: at these page sizes the cap
 * still covers 500 teams and 1000 projects per team, far past any real workspace.
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

/** An issue that already lives in the destination, as the duplicate check reads it. */
export type ExistingIssue = {
  id: string
  /** The human key, e.g. `ENG-42`. */
  identifier: string
  title: string
  url: string
  /** The workflow state's own name, verbatim from Linear — «In Progress», «Done». */
  stateName: string
  /**
   * The state's type is `completed` or `canceled`. Linear lets a workspace
   * rename its states freely, so the name alone cannot tell a finished issue
   * from a live one — the type can, and a match against a closed issue means
   * something different from a match against an open one.
   */
  closed: boolean
}

/** Where to look for existing issues: the project when there is one, else the team. */
export type DuplicateCheckScope = {
  teamId: string
  /** The project the push is aimed at; omitted, the whole team is searched. */
  projectId?: string | null
}

/**
 * How many issues one page asks for.
 *
 * Unlike TEAMS_QUERY these two hold a single connection, and everything under
 * it is flat but for `state` — no nested `pageInfo`, which is what tips the
 * complexity score over Linear's budget and earns a "Query too complex". 50 is
 * the same conservative figure PROJECT_PAGE_SIZE already runs at, and with
 * MAX_PAGES it covers 1000 issues per destination. As with the queries above,
 * do not raise it without re-testing this exact query against the real API.
 */
const ISSUE_PAGE_SIZE = 50

const PROJECT_ISSUES_QUERY = `query ProjectIssues($projectId: String!, $after: String) {
  project(id: $projectId) {
    issues(first: ${ISSUE_PAGE_SIZE}, after: $after) {
      nodes {
        id
        identifier
        title
        url
        state { name type }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

const TEAM_ISSUES_QUERY = `query TeamIssues($teamId: String!, $after: String) {
  team(id: $teamId) {
    issues(first: ${ISSUE_PAGE_SIZE}, after: $after) {
      nodes {
        id
        identifier
        title
        url
        state { name type }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

/**
 * Every issue already in the destination, so the tasks about to be pushed can
 * be compared against them. A project narrows the search to what the push would
 * land in; without one the team is the destination, so the team is the scope.
 *
 * Paginated like `listTeamsAndProjects`: a conservative page size, `MAX_PAGES`
 * as the backstop, and the loop ends as soon as the cursor stops advancing — a
 * duplicate check that silently saw only the first page would wave through the
 * very issue it exists to catch.
 */
export async function listIssuesForDuplicateCheck(
  apiKey: string,
  scope: DuplicateCheckScope,
): Promise<ExistingIssue[]> {
  const teamId = scope.teamId.trim()
  if (!teamId) throw new LinearApiError(400, 'Falta el equipo de Linear cuyos issues consultar.')

  const projectId = scope.projectId?.trim()
  const query = projectId ? PROJECT_ISSUES_QUERY : TEAM_ISSUES_QUERY
  const target = projectId ? { projectId } : { teamId }
  // Which field of `data` the connection hangs from, one per query above.
  const parent = projectId ? 'project' : 'team'

  const issues: ExistingIssue[] = []
  let after: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const body: unknown = await linearGraphQL(apiKey, query, {
      ...target,
      ...(after ? { after } : {}),
    })
    const connection = readConnection(isRecord(body) ? body[parent] : null, 'issues')
    if (!connection) {
      throw new LinearApiError(502, 'Linear respondió sin la lista de issues.')
    }

    for (const node of connection.nodes) {
      const issue = readExistingIssue(node)
      if (issue) issues.push(issue)
    }

    if (!connection.hasNextPage || !connection.endCursor) break
    after = connection.endCursor
  }

  return issues
}

/**
 * A Linear workflow state's type, as our own union.
 *
 * Linear names these six and a workspace cannot invent a seventh, but it can
 * add fields to the enum in a future API version — so an unknown value is read
 * as `unstarted` (the neutral «it exists and nobody finished it») rather than
 * breaking the parse of a response that is otherwise perfectly good.
 */
export type IssueStateType =
  | 'triage'
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'canceled'

const ISSUE_STATE_TYPES: readonly IssueStateType[] = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
]

/** What Linear currently says about an issue we created earlier. */
export type IssueState = {
  id: string
  /** The human key, e.g. `ENG-42`. */
  identifier: string
  title: string
  url: string
  /** The state's own name, verbatim from Linear — «In Progress», «Done». */
  stateName: string
  /**
   * The state's type. A workspace renames its states freely, so only the type
   * can tell a finished issue from a live one across workspaces.
   */
  stateType: IssueStateType
}

/**
 * How many ids one request filters by.
 *
 * The filtered query is as flat as PROJECT_ISSUES_QUERY — a single connection
 * whose only nested field is `state`, no nested `pageInfo` — so it stays well
 * inside the complexity budget documented on TEAM_PAGE_SIZE, and it runs at the
 * same conservative page size the other issue queries do. Matching the batch to
 * the page also means the common case, a note that produced a handful of
 * issues, is one request that comes back in one page. As with the queries
 * above, do not raise it without re-testing this exact query against the real
 * API.
 */
const ISSUE_ID_BATCH_SIZE = ISSUE_PAGE_SIZE

const ISSUE_STATES_QUERY = `query IssueStates($ids: [ID!], $after: String) {
  issues(first: ${ISSUE_PAGE_SIZE}, after: $after, filter: { id: { in: $ids } }) {
    nodes {
      id
      identifier
      title
      url
      state { name type }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

/**
 * The current state of the issues named by `ids` — what the history of a note
 * turns into once Linear has had its say.
 *
 * The ids are filtered on server-side in batches, so a note with thirty issues
 * costs one request and not thirty. An id Linear no longer knows (the issue was
 * deleted, or it belongs to a workspace this key cannot see) simply does not
 * come back: the caller pairs what it asked for against what it got, and the
 * missing ones are reported as such rather than crashing the lookup of the rest.
 */
export async function fetchIssueStates(apiKey: string, ids: string[]): Promise<IssueState[]> {
  // The same issue can sit in the history twice; asking for it once keeps it
  // from coming back twice when its copies fall in different batches.
  const wanted = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  // No ids means nothing to ask about — and a filter of `in: []` would still be
  // a round trip, plus a needless key check on a note that never went to Linear.
  if (wanted.length === 0) return []

  const states: IssueState[] = []

  for (let start = 0; start < wanted.length; start += ISSUE_ID_BATCH_SIZE) {
    const batch = wanted.slice(start, start + ISSUE_ID_BATCH_SIZE)
    let after: string | null = null

    // Paginated like `listIssuesForDuplicateCheck`: MAX_PAGES as the backstop
    // against a looping cursor, and the loop ends as soon as it stops advancing.
    for (let page = 0; page < MAX_PAGES; page++) {
      const body: unknown = await linearGraphQL(apiKey, ISSUE_STATES_QUERY, {
        ids: batch,
        ...(after ? { after } : {}),
      })
      const connection = readConnection(body, 'issues')
      if (!connection) {
        throw new LinearApiError(502, 'Linear respondió sin el estado de los issues.')
      }

      for (const node of connection.nodes) {
        const state = readIssueState(node)
        if (state) states.push(state)
      }

      if (!connection.hasNextPage || !connection.endCursor) break
      after = connection.endCursor
    }
  }

  return states
}

/** Where a task came from, appended to the issue body so it can be traced back. */
export type IssueSource = {
  /** Title of the meeting the task was extracted from. */
  meetingTitle: string
  /** `YYYY-MM-DD` when the transcript carried one. */
  date?: string | null
  /** Who the transcript put on the hook, verbatim; null when nobody was named. */
  mentioned?: string | null
  /** The line from the transcript that justifies the task, quoted verbatim. */
  evidence?: string | null
}

/** Everything `createIssue` needs. `projectId`/`parentId`/`source` are optional. */
export type CreateIssueInput = {
  teamId: string
  title: string
  description?: string
  priority?: Priority
  /** The project the issue lands in; omitted, Linear files it in the team's backlog. */
  projectId?: string | null
  /** The issue this one becomes a sub-issue of — how a meeting groups its tasks. */
  parentId?: string | null
  /** The deadline, `YYYY-MM-DD`. Omitted, the issue lands in Linear without one. */
  dueDate?: string | null
  /** Appended to `description` as a traceability block. Omitted for a parent issue. */
  source?: IssueSource | null
}

/** A created issue, as the push panel shows it. */
export type LinearIssue = {
  id: string
  /** The human key, e.g. `ENG-42`. */
  identifier: string
  url: string
}

/**
 * Our priority names on Linear's integer scale. Linear numbers priorities by
 * urgency with 0 meaning «no priority», so the order is not the obvious one and
 * a wrong mapping would silently file every task as urgent.
 */
const LINEAR_PRIORITY: Record<Priority, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
}

const CREATE_ISSUE_MUTATION = `mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier url }
  }
}`

/**
 * Create one issue and return it. Used for both the tasks and the parent they
 * hang from — the parent is just an issue created without a `source` block,
 * whose id then rides along as every task's `parentId`.
 */
export async function createIssue(
  apiKey: string,
  input: CreateIssueInput,
): Promise<LinearIssue> {
  const teamId = input.teamId.trim()
  if (!teamId) throw new LinearApiError(400, 'Falta el equipo de Linear donde crear la tarea.')

  const title = input.title.trim()
  if (!title) throw new LinearApiError(400, 'La tarea no tiene título.')

  const projectId = input.projectId?.trim()
  const parentId = input.parentId?.trim()
  const dueDate = input.dueDate?.trim()

  const variables = {
    input: {
      teamId,
      title,
      description: buildIssueDescription(input.description ?? '', input.source),
      priority: LINEAR_PRIORITY[input.priority ?? 'none'],
      ...(projectId ? { projectId } : {}),
      ...(parentId ? { parentId } : {}),
      // `dueDate` is a `TimelessDate`, so an empty string is not a value it
      // accepts — and the field arrives here as whatever the table holds. Same
      // conditional omission as above rather than a flat key, which keeps null,
      // undefined and `''` all meaning «no deadline».
      ...(dueDate ? { dueDate } : {}),
    },
  }

  const body = await linearGraphQL(apiKey, CREATE_ISSUE_MUTATION, variables)

  // `issueCreate` can answer 200 with `success: false` and no `errors`, which
  // reads as a created issue to anyone who only checks the HTTP status.
  const payload = isRecord(body) ? body.issueCreate : null
  if (!isRecord(payload) || payload.success !== true) {
    throw new LinearApiError(502, `Linear no creó la tarea «${title}».`)
  }

  const issue = readIssue(payload.issue)
  if (!issue) {
    throw new LinearApiError(502, `Linear creó «${title}» pero no devolvió sus datos.`)
  }
  return issue
}

/**
 * The issue body: what the user wrote, then the traceability block. The block
 * is what makes a pushed issue auditable — it names the meeting, when it
 * happened, who was put on the hook and the sentence that proves the task —
 * and it is separated by a rule so it never reads as part of the description.
 *
 * Every field is skipped when it is missing, and with nothing to say the block
 * is left out entirely rather than appended empty.
 */
export function buildIssueDescription(description: string, source?: IssueSource | null): string {
  const body = description.trim()
  if (!source) return body

  const meetingTitle = source.meetingTitle.trim()
  const date = source.date?.trim()
  const mentioned = source.mentioned?.trim()
  const evidence = source.evidence?.trim()

  const lines: string[] = []
  if (meetingTitle) lines.push(`**Source:** ${meetingTitle}${date ? ` — ${date}` : ''}`)
  else if (date) lines.push(`**Source:** ${date}`)
  if (mentioned) lines.push(`**Mentioned:** ${mentioned}`)
  if (evidence) {
    // A verbatim quote can be several lines long, and a blockquote only covers
    // the line it prefixes — an unprefixed second line would break out of it.
    if (lines.length > 0) lines.push('')
    lines.push(...evidence.split(/\r?\n/).map((line) => `> ${line.trim()}`))
  }
  if (lines.length === 0) return body
  if (!body) return lines.join('\n')

  return [body, '', '---', '', ...lines].join('\n')
}

/**
 * An issue node, or null when it is missing what the comparison needs — an
 * issue with no id or no title cannot be matched against a task nor linked to,
 * so it is dropped rather than left to break the listing, the same way
 * `readTeam` and `readProject` handle a partial node.
 */
function readExistingIssue(node: unknown): ExistingIssue | null {
  if (!isRecord(node)) return null

  const { id, identifier, title, url, state } = node
  if (typeof id !== 'string' || !id) return null
  if (typeof title !== 'string' || !title) return null

  const workflowState = isRecord(state) ? state : null
  const stateType = typeof workflowState?.type === 'string' ? workflowState.type : ''

  return {
    id,
    identifier: typeof identifier === 'string' ? identifier : '',
    title,
    url: typeof url === 'string' ? url : '',
    stateName: typeof workflowState?.name === 'string' ? workflowState.name : '',
    closed: stateType === 'completed' || stateType === 'canceled',
  }
}

/**
 * An issue node as the state lookup reads it, or null when it is missing what
 * the report needs — dropped like a partial node in `readTeam` and
 * `readProject` rather than left to break the whole batch.
 */
function readIssueState(node: unknown): IssueState | null {
  if (!isRecord(node)) return null

  const { id, identifier, title, url, state } = node
  if (typeof id !== 'string' || !id) return null
  if (typeof title !== 'string' || !title) return null

  const workflowState = isRecord(state) ? state : null

  return {
    id,
    identifier: typeof identifier === 'string' ? identifier : '',
    title,
    url: typeof url === 'string' ? url : '',
    stateName: typeof workflowState?.name === 'string' ? workflowState.name : '',
    stateType: readIssueStateType(workflowState?.type),
  }
}

/** Linear's state type, or `unstarted` for anything this build does not know. */
function readIssueStateType(input: unknown): IssueStateType {
  return ISSUE_STATE_TYPES.find((type) => type === input) ?? 'unstarted'
}

function readIssue(node: unknown): LinearIssue | null {
  if (!isRecord(node)) return null

  const { id, identifier, url } = node
  if (typeof id !== 'string' || !id) return null

  return {
    id,
    identifier: typeof identifier === 'string' ? identifier : '',
    url: typeof url === 'string' ? url : '',
  }
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
 * What our own route answers for a rejection by Linear.
 *
 * 401 and 403 are genuinely about the key, so they surface as 401 and the UI
 * can tell the user to check it. A 400 is not: Linear returns it for a query we
 * built wrong — "Query too complex" is the one that bit us — and reporting that
 * as an auth failure sends the user off checking a key that was never the
 * problem. Our own bug reads as 502, with Linear's message carried through.
 */
function statusFor(upstream: number): number {
  return upstream === 401 || upstream === 403 ? 401 : 502
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
