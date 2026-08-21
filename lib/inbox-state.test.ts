import { describe, expect, it } from 'vitest'

import type { InboxItem } from '@/lib/inbox'
import type { InboxResponse } from '@/lib/inbox-client'
import { INITIAL_INBOX, inboxReducer, type InboxState } from '@/lib/inbox-state'

function item(partial: Partial<InboxItem> = {}): InboxItem {
  return {
    relPath: '2026/agosto/reunion.md',
    fileName: 'reunion.md',
    title: 'Reunión de agosto',
    date: '2026-08-12',
    folder: '2026/agosto',
    words: 420,
    approxTokens: 560,
    status: 'untouched',
    ...partial,
  }
}

function response(partial: Partial<InboxResponse> = {}): InboxResponse {
  return { items: [item()], truncated: false, scanned: 12, ...partial }
}

/** The state after one request left and came back, as most tests need it. */
function ready(token = 1): InboxState {
  const started = inboxReducer(INITIAL_INBOX, { type: 'started', token })
  return inboxReducer(started, { type: 'resolved', token, response: response() })
}

describe('inboxReducer', () => {
  it('starts with nothing loaded, which is not the same as an empty inbox', () => {
    expect(INITIAL_INBOX).toEqual({
      token: 0,
      loading: false,
      loaded: false,
      items: [],
      truncated: false,
      scanned: 0,
      error: null,
    })
  })

  it('is loading while a request is in flight', () => {
    const state = inboxReducer(INITIAL_INBOX, { type: 'started', token: 1 })

    expect(state.loading).toBe(true)
    expect(state.token).toBe(1)
    expect(state.loaded).toBe(false)
  })

  it('writes the answer of the request it is waiting for', () => {
    expect(ready()).toEqual({
      token: 1,
      loading: false,
      loaded: true,
      items: [item()],
      truncated: false,
      scanned: 12,
      error: null,
    })
  })

  it('reports a truncated walk as it arrives', () => {
    const started = inboxReducer(INITIAL_INBOX, { type: 'started', token: 1 })
    const state = inboxReducer(started, {
      type: 'resolved',
      token: 1,
      response: response({ truncated: true, scanned: 5000 }),
    })

    expect(state.truncated).toBe(true)
    expect(state.scanned).toBe(5000)
  })

  it('keeps the rows on screen while they are being reloaded', () => {
    const reloading = inboxReducer(ready(), { type: 'started', token: 2 })

    expect(reloading.loading).toBe(true)
    expect(reloading.loaded).toBe(true)
    expect(reloading.items).toEqual([item()])
  })

  it('clears a previous error when a new request starts', () => {
    const failed = inboxReducer(ready(), { type: 'failed', token: 1, message: 'Se rompió' })
    const retrying = inboxReducer(failed, { type: 'started', token: 2 })

    expect(retrying.error).toBeNull()
  })

  it('reports a failure without throwing away the list it already had', () => {
    const state = inboxReducer(ready(), { type: 'failed', token: 1, message: 'Se rompió' })

    expect(state).toMatchObject({
      loading: false,
      loaded: true,
      items: [item()],
      error: 'Se rompió',
    })
  })

  it('stays not-loaded when the very first request fails', () => {
    const started = inboxReducer(INITIAL_INBOX, { type: 'started', token: 1 })
    const state = inboxReducer(started, { type: 'failed', token: 1, message: 'Se rompió' })

    expect(state.loaded).toBe(false)
    expect(state.items).toEqual([])
    expect(state.error).toBe('Se rompió')
  })

  it('replaces the rows when a newer answer lands', () => {
    const reloading = inboxReducer(ready(), { type: 'started', token: 2 })
    const state = inboxReducer(reloading, {
      type: 'resolved',
      token: 2,
      response: response({ items: [], scanned: 3 }),
    })

    expect(state.items).toEqual([])
    expect(state.scanned).toBe(3)
    expect(state.loaded).toBe(true)
  })

  it('ignores the answer of a request that is no longer the one being waited for', () => {
    const reloading = inboxReducer(ready(), { type: 'started', token: 2 })
    const late = inboxReducer(reloading, {
      type: 'resolved',
      token: 1,
      response: response({ items: [], scanned: 999 }),
    })

    // The same object, so React re-renders nothing at all for a stale answer.
    expect(late).toBe(reloading)
  })

  it('ignores the failure of a request that is no longer the one being waited for', () => {
    const reloading = inboxReducer(ready(), { type: 'started', token: 2 })
    const late = inboxReducer(reloading, { type: 'failed', token: 1, message: 'Se rompió' })

    expect(late).toBe(reloading)
  })
})
