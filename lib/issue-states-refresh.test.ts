import { describe, expect, it } from 'vitest'

import {
  ISSUE_STATES_REFRESH_INTERVAL_MS,
  type RefreshInput,
  shouldRefresh,
} from '@/lib/issue-states-refresh'

const NOW = 1_700_000_000_000

/** A note that is due: open, with a key, with a history, and long unread. */
function input(partial: Partial<RefreshInput> = {}): RefreshInput {
  return {
    enabled: true,
    visible: true,
    inFlight: false,
    lastAskedAt: NOW - ISSUE_STATES_REFRESH_INTERVAL_MS,
    now: NOW,
    ...partial,
  }
}

describe('ISSUE_STATES_REFRESH_INTERVAL_MS', () => {
  it('is a whole number of seconds, long enough not to hammer Linear', () => {
    expect(ISSUE_STATES_REFRESH_INTERVAL_MS % 1000).toBe(0)
    expect(ISSUE_STATES_REFRESH_INTERVAL_MS).toBeGreaterThanOrEqual(30_000)
  })
})

describe('shouldRefresh', () => {
  it('asks once the interval has gone by', () => {
    expect(shouldRefresh(input())).toBe(true)
  })

  it('asks when the interval has been exceeded', () => {
    expect(shouldRefresh(input({ lastAskedAt: NOW - 10 * ISSUE_STATES_REFRESH_INTERVAL_MS })))
      .toBe(true)
  })

  it('waits while the report is still fresh', () => {
    expect(shouldRefresh(input({ lastAskedAt: NOW - 1 }))).toBe(false)
    expect(shouldRefresh(input({ lastAskedAt: NOW - (ISSUE_STATES_REFRESH_INTERVAL_MS - 1) })))
      .toBe(false)
  })

  it('asks for a note that has never been read', () => {
    expect(shouldRefresh(input({ lastAskedAt: null }))).toBe(true)
  })

  it('never asks about a note with no key, no history or no note at all', () => {
    expect(shouldRefresh(input({ enabled: false }))).toBe(false)
    expect(shouldRefresh(input({ enabled: false, lastAskedAt: null }))).toBe(false)
  })

  it('never asks on a hidden tab, however stale the report is', () => {
    expect(shouldRefresh(input({ visible: false }))).toBe(false)
    expect(shouldRefresh(input({ visible: false, lastAskedAt: null }))).toBe(false)
    expect(shouldRefresh(input({ visible: false, lastAskedAt: NOW - 60 * 60 * 1000 }))).toBe(false)
  })

  it('never overlaps two queries of the same note', () => {
    expect(shouldRefresh(input({ inFlight: true }))).toBe(false)
    expect(shouldRefresh(input({ inFlight: true, lastAskedAt: NOW - 60 * 60 * 1000 }))).toBe(false)
  })

  it('stamps freshness from when the query started, not from when it answered', () => {
    // A request that took longer than the interval is not immediately followed
    // by another: `lastAskedAt` moved when it left, so the next tick is due one
    // whole interval after that.
    const started = NOW - ISSUE_STATES_REFRESH_INTERVAL_MS - 1
    expect(shouldRefresh(input({ lastAskedAt: started, inFlight: true }))).toBe(false)
    expect(shouldRefresh(input({ lastAskedAt: NOW, inFlight: false }))).toBe(false)
  })

  it('reads a clock that has moved backwards as due rather than as fresh', () => {
    expect(shouldRefresh(input({ lastAskedAt: NOW + 60 * 60 * 1000 }))).toBe(true)
  })

  it('honours an interval given by the caller', () => {
    expect(shouldRefresh(input({ lastAskedAt: NOW - 5_000, intervalMs: 10_000 }))).toBe(false)
    expect(shouldRefresh(input({ lastAskedAt: NOW - 5_000, intervalMs: 5_000 }))).toBe(true)
  })

  it('needs every condition at once', () => {
    const flags = ['enabled', 'visible'] as const
    for (const flag of flags) {
      expect(shouldRefresh(input({ [flag]: false }))).toBe(false)
    }
    expect(shouldRefresh(input({ enabled: true, visible: true, inFlight: false }))).toBe(true)
  })
})
