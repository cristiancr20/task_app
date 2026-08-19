import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Priority } from '@/lib/extractors/task'
import {
  LinearApiError,
  LinearUnreachableError,
  buildIssueDescription,
  createIssue,
  linearGraphQL,
  listTeamsAndProjects,
} from '@/lib/linear'

/**
 * The whole module talks to Linear through `fetch`, so every test here replaces
 * it with `vi.stubGlobal` and answers from a fixture. Nothing in this file
 * touches the network or a real workspace — the key below is a made-up string.
 */
const API_KEY = 'lin_api_test'

/** One request the module made, decoded far enough to assert on. */
type Call = {
  url: string
  query: string
  variables: Record<string, unknown> | undefined
  headers: Record<string, string>
}

/**
 * Swap `fetch` for `reply`, and return the list the calls accumulate into.
 * `reply` is a function rather than a queue so a test can answer the same thing
 * forever — which is how the non-advancing cursor is exercised.
 */
function stubFetch(reply: (call: Call, index: number) => Response): Call[] {
  const calls: Call[] = []

  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body ?? '{}')) as {
      query?: string
      variables?: Record<string, unknown>
    }
    const call: Call = {
      url: String(input),
      query: sent.query ?? '',
      variables: sent.variables,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    calls.push(call)
    return reply(call, calls.length - 1)
  })

  return calls
}

/** A real `Response`, so `ok`/`status`/`json()` behave exactly as in production. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildIssueDescription', () => {
  it('returns the body untouched when there is no source', () => {
    expect(buildIssueDescription('Escribir el informe')).toBe('Escribir el informe')
    expect(buildIssueDescription('  Escribir el informe  ', null)).toBe('Escribir el informe')
  })

  it('appends the traceability block after a rule', () => {
    const result = buildIssueDescription('Escribir el informe', {
      meetingTitle: 'Weekly sync',
      date: '2026-08-09',
      mentioned: 'Ana',
      evidence: 'Ana se encarga del informe.',
    })

    expect(result).toBe(
      [
        'Escribir el informe',
        '',
        '---',
        '',
        '**Source:** Weekly sync — 2026-08-09',
        '**Mentioned:** Ana',
        '',
        '> Ana se encarga del informe.',
      ].join('\n'),
    )
  })

  it('prefixes every line of a multi-line quote', () => {
    const result = buildIssueDescription('', {
      meetingTitle: 'Weekly sync',
      evidence: 'Ana: yo lo hago.\r\nLuis: perfecto.\n  Ana: mañana.  ',
    })

    expect(result).toBe(
      [
        '**Source:** Weekly sync',
        '',
        '> Ana: yo lo hago.',
        '> Luis: perfecto.',
        '> Ana: mañana.',
      ].join('\n'),
    )
  })

  it('leaves the block out entirely when no field has content', () => {
    const result = buildIssueDescription('Escribir el informe', {
      meetingTitle: '   ',
      date: null,
      mentioned: null,
      evidence: '',
    })

    expect(result).toBe('Escribir el informe')
    expect(result).not.toContain('---')
  })

  it('falls back to the date when the meeting has no title', () => {
    const result = buildIssueDescription('', { meetingTitle: '', date: '2026-08-09' })

    expect(result).toBe('**Source:** 2026-08-09')
  })
})

describe('createIssue', () => {
  const created = {
    data: {
      issueCreate: {
        success: true,
        issue: { id: 'iss_1', identifier: 'ENG-42', url: 'https://linear.app/x/issue/ENG-42' },
      },
    },
  }

  /** The `input` object handed to the `issueCreate` mutation. */
  function sentInput(call: Call): Record<string, unknown> {
    return (call.variables as { input: Record<string, unknown> }).input
  }

  it('returns the created issue', async () => {
    stubFetch(() => json(created))

    expect(await createIssue(API_KEY, { teamId: 't1', title: 'Escribir el informe' })).toEqual({
      id: 'iss_1',
      identifier: 'ENG-42',
      url: 'https://linear.app/x/issue/ENG-42',
    })
  })

  // Linear numbers priorities by urgency with 0 meaning «none», so the mapping
  // is not alphabetical and not the order our own union is written in.
  it.each<[Priority, number]>([
    ['urgent', 1],
    ['high', 2],
    ['medium', 3],
    ['low', 4],
    ['none', 0],
  ])('maps priority %s to Linear %i', async (priority, expected) => {
    const calls = stubFetch(() => json(created))

    await createIssue(API_KEY, { teamId: 't1', title: 'Tarea', priority })

    expect(sentInput(calls[0]).priority).toBe(expected)
  })

  it('defaults to no priority when none is given', async () => {
    const calls = stubFetch(() => json(created))

    await createIssue(API_KEY, { teamId: 't1', title: 'Tarea' })

    expect(sentInput(calls[0]).priority).toBe(0)
  })

  it('sends projectId and parentId when they carry a value', async () => {
    const calls = stubFetch(() => json(created))

    await createIssue(API_KEY, {
      teamId: 't1',
      title: 'Tarea',
      projectId: ' p1 ',
      parentId: ' iss_parent ',
    })

    expect(sentInput(calls[0])).toMatchObject({ projectId: 'p1', parentId: 'iss_parent' })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('omits projectId and parentId when %s', async (_label, value) => {
    const calls = stubFetch(() => json(created))

    await createIssue(API_KEY, {
      teamId: 't1',
      title: 'Tarea',
      projectId: value,
      parentId: value,
    })

    const input = sentInput(calls[0])
    expect(input).not.toHaveProperty('projectId')
    expect(input).not.toHaveProperty('parentId')
  })

  it('rejects a 200 that says success: false', async () => {
    // The issue node is present and valid on purpose: with `issue: null` the
    // next guard down would throw anyway and the test would stay green even
    // with the success check deleted.
    stubFetch(() =>
      json({ data: { issueCreate: { success: false, issue: created.data.issueCreate.issue } } }),
    )

    await expect(createIssue(API_KEY, { teamId: 't1', title: 'Tarea' })).rejects.toMatchObject({
      name: 'LinearApiError',
      status: 502,
      message: 'Linear no creó la tarea «Tarea».',
    })
  })

  it('rejects a success: true with no issue in it', async () => {
    stubFetch(() => json({ data: { issueCreate: { success: true, issue: null } } }))

    await expect(createIssue(API_KEY, { teamId: 't1', title: 'Tarea' })).rejects.toBeInstanceOf(
      LinearApiError,
    )
  })

  it.each([
    ['team', { teamId: '  ', title: 'Tarea' }],
    ['title', { teamId: 't1', title: '   ' }],
  ])('refuses to send a request with no %s', async (_label, input) => {
    const calls = stubFetch(() => json(created))

    await expect(createIssue(API_KEY, input)).rejects.toMatchObject({ status: 400 })
    expect(calls).toHaveLength(0)
  })
})

describe('listTeamsAndProjects', () => {
  const isTeamsPage = (call: Call) => call.query.includes('query Teams(')

  function teamsPage(nodes: unknown[], pageInfo: { hasNextPage: boolean; endCursor: string | null }) {
    return json({ data: { teams: { nodes, pageInfo } } })
  }

  function projectsPage(
    nodes: unknown[],
    pageInfo: { hasNextPage: boolean; endCursor: string | null },
  ) {
    return json({ data: { team: { projects: { nodes, pageInfo } } } })
  }

  it('follows both cursors and returns everything sorted by name', async () => {
    const calls = stubFetch((call) => {
      if (isTeamsPage(call)) {
        return call.variables?.after === 'teams-2'
          ? teamsPage(
              [
                {
                  id: 't-mid',
                  name: 'Mid',
                  key: 'MID',
                  projects: {
                    nodes: [{ id: 'p-gamma', name: 'Gamma' }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              ],
              { hasNextPage: false, endCursor: null },
            )
          : teamsPage(
              [
                {
                  id: 't-zeta',
                  name: 'Zeta',
                  key: 'ZET',
                  projects: {
                    nodes: [{ id: 'p-beta', name: 'Beta' }],
                    pageInfo: { hasNextPage: true, endCursor: 'zeta-2' },
                  },
                },
                {
                  id: 't-alpha',
                  name: 'Alpha',
                  key: 'ALP',
                  projects: {
                    nodes: [{ id: 'p-delta', name: 'Delta' }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              ],
              { hasNextPage: true, endCursor: 'teams-2' },
            )
      }

      return call.variables?.after === 'zeta-3'
        ? projectsPage([{ id: 'p-carl', name: 'Carl' }], { hasNextPage: false, endCursor: null })
        : projectsPage([{ id: 'p-alfa', name: 'Alfa' }], { hasNextPage: true, endCursor: 'zeta-3' })
    })

    const teams = await listTeamsAndProjects(API_KEY)

    expect(teams.map((team) => team.name)).toEqual(['Alpha', 'Mid', 'Zeta'])
    expect(teams[2]).toEqual({
      id: 't-zeta',
      name: 'Zeta',
      key: 'ZET',
      projects: [
        { id: 'p-alfa', name: 'Alfa' },
        { id: 'p-beta', name: 'Beta' },
        { id: 'p-carl', name: 'Carl' },
      ],
    })
    expect(teams[0].projects).toEqual([{ id: 'p-delta', name: 'Delta' }])

    // Two pages of teams, plus the two the overflowing team's projects needed.
    expect(calls.filter(isTeamsPage)).toHaveLength(2)
    expect(calls.filter((call) => !isTeamsPage(call)).map((call) => call.variables)).toEqual([
      { teamId: 't-zeta', after: 'zeta-2' },
      { teamId: 't-zeta', after: 'zeta-3' },
    ])
  })

  it('makes no extra request when every team fits in one page of projects', async () => {
    const calls = stubFetch(() =>
      teamsPage(
        [
          {
            id: 't1',
            name: 'Solo',
            key: 'SOL',
            projects: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          },
        ],
        { hasNextPage: false, endCursor: null },
      ),
    )

    await listTeamsAndProjects(API_KEY)

    expect(calls).toHaveLength(1)
  })

  // Mirrors MAX_PAGES in lib/linear.ts, which is not exported.
  const MAX_PAGES = 20

  it('stops at MAX_PAGES when the team cursor never advances', async () => {
    const calls = stubFetch(() => teamsPage([], { hasNextPage: true, endCursor: 'stuck' }))

    await expect(listTeamsAndProjects(API_KEY)).resolves.toEqual([])
    expect(calls).toHaveLength(MAX_PAGES)
  })

  it('stops at MAX_PAGES when the project cursor never advances', async () => {
    const calls = stubFetch((call) =>
      isTeamsPage(call)
        ? teamsPage(
            [
              {
                id: 't1',
                name: 'Solo',
                key: 'SOL',
                projects: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'stuck' } },
              },
            ],
            { hasNextPage: false, endCursor: null },
          )
        : projectsPage([], { hasNextPage: true, endCursor: 'stuck' }),
    )

    await expect(listTeamsAndProjects(API_KEY)).resolves.toHaveLength(1)
    expect(calls.filter((call) => !isTeamsPage(call))).toHaveLength(MAX_PAGES)
  })

  it('reports a response with no teams connection', async () => {
    stubFetch(() => json({ data: {} }))

    await expect(listTeamsAndProjects(API_KEY)).rejects.toMatchObject({
      name: 'LinearApiError',
      status: 502,
    })
  })
})

describe('linearGraphQL', () => {
  it('sends the key in Authorization with no Bearer prefix', async () => {
    const calls = stubFetch(() => json({ data: { ok: true } }))

    await linearGraphQL(API_KEY, 'query { ok }')

    expect(calls[0].headers.authorization).toBe(API_KEY)
  })

  it('translates a 401 into a 401 the UI can act on', async () => {
    stubFetch(() => json({ errors: [{ message: 'Authentication required' }] }, 401))

    await expect(linearGraphQL(API_KEY, 'query { ok }')).rejects.toMatchObject({
      name: 'LinearApiError',
      status: 401,
      message: 'Linear: Authentication required',
    })
  })

  // A 400 is our own bad query, not a bad key — reporting it as 401 would send
  // the user off checking a key that was never the problem.
  it('translates a 400 into a 502 keeping the message from Linear', async () => {
    stubFetch(() => json({ errors: [{ message: 'Query too complex' }] }, 400))

    await expect(linearGraphQL(API_KEY, 'query { ok }')).rejects.toMatchObject({
      status: 502,
      message: 'Linear: Query too complex',
    })
  })

  it('reports the HTTP status when the body carries no errors', async () => {
    stubFetch(() => json({}, 500))

    await expect(linearGraphQL(API_KEY, 'query { ok }')).rejects.toMatchObject({
      status: 502,
      message: 'Linear respondió HTTP 500.',
    })
  })

  it('surfaces errors that come back with a 200', async () => {
    stubFetch(() => json({ errors: [{ message: 'Entity not found' }], data: null }))

    await expect(linearGraphQL(API_KEY, 'query { ok }')).rejects.toMatchObject({
      status: 502,
      message: 'Linear: Entity not found',
    })
  })

  it('turns a failed fetch into LinearUnreachableError', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })

    await expect(linearGraphQL(API_KEY, 'query { ok }')).rejects.toBeInstanceOf(
      LinearUnreachableError,
    )
  })

  it('refuses an empty key before reaching the network', async () => {
    const calls = stubFetch(() => json({ data: {} }))

    await expect(linearGraphQL('   ', 'query { ok }')).rejects.toMatchObject({ status: 401 })
    expect(calls).toHaveLength(0)
  })
})
