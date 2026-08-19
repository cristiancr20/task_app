import { describe, expect, it } from 'vitest'

import {
  checkRows,
  type CheckableRow,
  isOpenDuplicate,
  matchesOf,
  matchIssue,
  needsCheck,
  type PathChecks,
  pendingRowIds,
  scopeFromKey,
  scopeKeyOf,
} from '@/lib/duplicate-check'
import type { ExistingIssue } from '@/lib/linear'
import { DUPLICATE_THRESHOLD, similarity } from '@/lib/similarity'

function issue(partial: Partial<ExistingIssue> & { title: string }): ExistingIssue {
  return {
    id: partial.title,
    identifier: 'ENG-1',
    url: 'https://linear.app/acme/issue/ENG-1',
    stateName: 'Todo',
    closed: false,
    ...partial,
  }
}

const MIGRATION = issue({
  id: 'i1',
  identifier: 'ENG-11',
  title: 'Migración del endpoint de pagos',
  url: 'https://linear.app/acme/issue/ENG-11',
})
const INVOICE = issue({
  id: 'i2',
  identifier: 'ENG-22',
  title: 'Contratar el seguro de la oficina',
  url: 'https://linear.app/acme/issue/ENG-22',
})

describe('scopeKeyOf', () => {
  it('is null with no team, which is no destination to query', () => {
    expect(scopeKeyOf(null)).toBeNull()
    expect(scopeKeyOf(undefined)).toBeNull()
    expect(scopeKeyOf({ teamId: '   ', projectId: 'p1' })).toBeNull()
  })

  it('tells two destinations apart', () => {
    const one = scopeKeyOf({ teamId: 't1', projectId: 'p1' })
    expect(one).not.toBe(scopeKeyOf({ teamId: 't1', projectId: 'p2' }))
    expect(one).not.toBe(scopeKeyOf({ teamId: 't2', projectId: 'p1' }))
    expect(one).not.toBe(scopeKeyOf({ teamId: 't1', projectId: null }))
  })

  it('is the same key for the same destination, whitespace aside', () => {
    expect(scopeKeyOf({ teamId: ' t1 ', projectId: ' p1 ' })).toBe(
      scopeKeyOf({ teamId: 't1', projectId: 'p1' }),
    )
  })

  it('round-trips through scopeFromKey, which is what the request is built from', () => {
    for (const scope of [
      { teamId: 't1', projectId: 'p1' },
      { teamId: 't1', projectId: null },
    ]) {
      expect(scopeFromKey(scopeKeyOf(scope) ?? '')).toEqual(scope)
    }
  })

  it('reads a blank project as no project rather than as a project called «»', () => {
    expect(scopeFromKey(scopeKeyOf({ teamId: 't1', projectId: '  ' }) ?? '')).toEqual({
      teamId: 't1',
      projectId: null,
    })
  })
})

describe('matchIssue', () => {
  it('is null when the destination holds nothing', () => {
    expect(matchIssue('Migrar el endpoint de pagos', [])).toBeNull()
  })

  it('is null when nothing in the destination resembles the row', () => {
    // Not because the score is 0 — two unrelated Spanish titles share enough
    // letters to be worth 0.09 for nothing, and that is what the floor is for.
    expect(similarity('Migrar el endpoint de pagos', INVOICE.title)).toBeGreaterThan(0)
    expect(matchIssue('Migrar el endpoint de pagos', [INVOICE])).toBeNull()
  })

  it('reports the issue, its score and everything the row needs to show it', () => {
    const match = matchIssue('Migrar el endpoint de pagos', [INVOICE, MIGRATION])

    expect(match).not.toBeNull()
    expect(match?.identifier).toBe('ENG-11')
    expect(match?.title).toBe('Migración del endpoint de pagos')
    expect(match?.url).toBe('https://linear.app/acme/issue/ENG-11')
    expect(match?.closed).toBe(false)
    expect(match?.score).toBeGreaterThan(DUPLICATE_THRESHOLD)
    expect(match?.duplicate).toBe(true)
  })

  it('reports a close-but-not-close-enough match without calling it a duplicate', () => {
    const match = matchIssue('Documentar el endpoint de pagos en la wiki', [
      issue({ id: 'i3', title: 'Migrar el endpoint de pagos a la nueva API' }),
    ])

    expect(match?.score).toBeGreaterThan(0)
    expect(match?.score).toBeLessThan(DUPLICATE_THRESHOLD)
    expect(match?.duplicate).toBe(false)
  })

  it('says when the issue it matched is completed or cancelled', () => {
    const match = matchIssue('Migrar el endpoint de pagos', [
      issue({ ...MIGRATION, closed: true, stateName: 'Done' }),
    ])

    expect(match?.duplicate).toBe(true)
    expect(match?.closed).toBe(true)
  })

  it('keeps the closest of several, not the first one that is close enough', () => {
    const match = matchIssue('Migrar el endpoint de pagos', [
      issue({ id: 'i4', identifier: 'ENG-44', title: 'Migrar el endpoint de facturas' }),
      MIGRATION,
    ])

    expect(match?.identifier).toBe('ENG-11')
  })

  it('is null for a row with no title yet', () => {
    expect(matchIssue('   ', [MIGRATION])).toBeNull()
  })
})

describe('checkRows', () => {
  const rows: CheckableRow[] = [
    { id: 'r1', title: 'Migrar el endpoint de pagos' },
    { id: 'r2', title: 'Contratar el seguro de la oficina' },
  ]

  it('scores every row against the destination', () => {
    const checks = checkRows(rows, [MIGRATION, INVOICE])

    expect(checks.r1?.match?.identifier).toBe('ENG-11')
    expect(checks.r2?.match?.identifier).toBe('ENG-22')
  })

  it('records a row nothing resembles as checked with no match', () => {
    const checks = checkRows([rows[0]], [INVOICE])

    expect(checks.r1).toEqual({ title: rows[0].title, match: null })
  })

  it('keeps the previous result of a row whose title has not changed', () => {
    const first = checkRows(rows, [MIGRATION, INVOICE])
    const second = checkRows(rows, [], first)

    // Scored against an empty destination, a recomputed row would be null.
    expect(second.r1).toBe(first.r1)
    expect(second.r2).toBe(first.r2)
  })

  it('re-scores a row the user retyped, and only that one', () => {
    const first = checkRows(rows, [MIGRATION, INVOICE])
    const second = checkRows(
      [{ id: 'r1', title: 'Contratar el seguro de la oficina' }, rows[1]],
      [MIGRATION, INVOICE],
      first,
    )

    expect(second.r1?.match?.identifier).toBe('ENG-22')
    expect(second.r2).toBe(first.r2)
  })

  it('forgets the rows it is not given — the deleted and the already created', () => {
    const first = checkRows(rows, [MIGRATION, INVOICE])
    const second = checkRows([rows[1]], [MIGRATION, INVOICE], first)

    expect(Object.keys(second)).toEqual(['r2'])
  })
})

describe('pendingRowIds', () => {
  const rows: CheckableRow[] = [
    { id: 'r1', title: 'Migrar el endpoint de pagos' },
    { id: 'r2', title: 'Contratar el seguro' },
  ]

  it('is every row when nothing has been checked', () => {
    expect(pendingRowIds(rows, {})).toEqual(['r1', 'r2'])
  })

  it('is empty once every row has been scored as it stands', () => {
    expect(pendingRowIds(rows, checkRows(rows, [MIGRATION]))).toEqual([])
  })

  it('is the retyped row, whose result is about a title it no longer has', () => {
    const checks = checkRows(rows, [MIGRATION])
    expect(pendingRowIds([{ id: 'r1', title: 'Otra cosa' }, rows[1]], checks)).toEqual(['r1'])
  })
})

describe('needsCheck', () => {
  const rows: CheckableRow[] = [{ id: 'r1', title: 'Migrar el endpoint de pagos' }]
  const entry: PathChecks = {
    scopeKey: 'k1',
    attempt: 0,
    checks: checkRows(rows, [MIGRATION]),
  }

  it('is false with no rows to compare', () => {
    expect(needsCheck([], undefined, { scopeKey: 'k1', attempt: 0 })).toBe(false)
  })

  it('is true for a note that has never been checked', () => {
    expect(needsCheck(rows, undefined, { scopeKey: 'k1', attempt: 0 })).toBe(true)
  })

  it('is false once every row is scored against this destination and round', () => {
    expect(needsCheck(rows, entry, { scopeKey: 'k1', attempt: 0 })).toBe(false)
  })

  it('is true when the destination changed under the results', () => {
    expect(needsCheck(rows, entry, { scopeKey: 'k2', attempt: 0 })).toBe(true)
  })

  it('is true when «Buscar duplicados» asked for another round', () => {
    expect(needsCheck(rows, entry, { scopeKey: 'k1', attempt: 1 })).toBe(true)
  })

  it('is true for a row added after the last check', () => {
    expect(
      needsCheck([...rows, { id: 'r2', title: 'Nueva tarea' }], entry, {
        scopeKey: 'k1',
        attempt: 0,
      }),
    ).toBe(true)
  })
})

describe('matchesOf', () => {
  const rows: CheckableRow[] = [
    { id: 'r1', title: 'Migrar el endpoint de pagos' },
    { id: 'r2', title: 'Contratar el seguro de la oficina' },
  ]
  const entry: PathChecks = {
    scopeKey: 'k1',
    attempt: 0,
    checks: checkRows(rows, [MIGRATION]),
  }

  it('is empty when the note has never been checked', () => {
    expect(matchesOf(rows, undefined, 'k1')).toEqual({})
  })

  it('is empty when there is no destination selected', () => {
    expect(matchesOf(rows, entry, null)).toEqual({})
  })

  it('is empty when the results belong to another destination', () => {
    expect(matchesOf(rows, entry, 'k2')).toEqual({})
  })

  it('reports the match of every row, and the absence of one as null', () => {
    expect(matchesOf(rows, entry, 'k1')).toEqual({
      r1: entry.checks.r1?.match,
      r2: null,
    })
  })

  it('drops the row the user is retyping until its check catches up', () => {
    const retyped = [{ id: 'r1', title: 'Migrar el endpoint de pag' }, rows[1]]
    const matches = matchesOf(retyped, entry, 'k1')

    expect('r1' in matches).toBe(false)
    expect(matches.r2).toBeNull()
  })

  it('says nothing about a row that was not checked', () => {
    expect(matchesOf([{ id: 'r3', title: 'Añadida a mano' }], entry, 'k1')).toEqual({})
  })
})

describe('isOpenDuplicate', () => {
  const match = {
    score: 0.9,
    identifier: 'ENG-11',
    title: 'Migración del endpoint de pagos',
    url: 'https://linear.app/acme/issue/ENG-11',
    closed: false,
    duplicate: true,
  }

  it('is true for a duplicate of something still open', () => {
    expect(isOpenDuplicate(match)).toBe(true)
  })

  it('is false when the issue is already completed or cancelled', () => {
    expect(isOpenDuplicate({ ...match, closed: true })).toBe(false)
  })

  it('is false for a match that did not reach the threshold', () => {
    expect(isOpenDuplicate({ ...match, score: 0.4, duplicate: false })).toBe(false)
  })

  it('is false when there is no match, and when there is no answer yet', () => {
    expect(isOpenDuplicate(null)).toBe(false)
    expect(isOpenDuplicate(undefined)).toBe(false)
  })
})
