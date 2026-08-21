/**
 * What the inbox looks like while it is being loaded, as a pure reducer.
 *
 * Same shape and same reasoning as `lib/search-state.ts`: every request carries
 * an increasing token, the state remembers the one it is waiting for, and an
 * answer to any other token returns the *same object* so React re-renders
 * nothing. Two clicks on «Recargar» therefore cannot end with the older walk
 * on screen.
 *
 * The one difference is what happens to the rows meanwhile: they are kept. A
 * reload that blanked the table and put it back a second later would make the
 * button feel like it lost the list, and an error while reloading would throw
 * away a perfectly good answer over a failure to get a newer one.
 */

import type { InboxItem } from './inbox'
import type { InboxResponse } from './inbox-client'

export type InboxState = {
  /** The request whose answer is worth writing. `0` before the first one. */
  token: number
  /** A request is in flight. Rows may still be on screen from an older one. */
  loading: boolean
  /** An answer has arrived at least once, which is what tells «vacía» from «aún no». */
  loaded: boolean
  items: InboxItem[]
  /** The walk hit a limit: this is not everything that is on disk. */
  truncated: boolean
  /** Notes the walk saw, pending or not. */
  scanned: number
  /** The last failure, already worded for the user; null when the last try worked. */
  error: string | null
}

export type InboxAction =
  | { type: 'started'; token: number }
  | { type: 'resolved'; token: number; response: InboxResponse }
  | { type: 'failed'; token: number; message: string }

/** Nothing asked for yet: no rows, no error, and explicitly not loaded. */
export const INITIAL_INBOX: InboxState = {
  token: 0,
  loading: false,
  loaded: false,
  items: [],
  truncated: false,
  scanned: 0,
  error: null,
}

export function inboxReducer(state: InboxState, action: InboxAction): InboxState {
  switch (action.type) {
    case 'started':
      // The rows stay: a reload shows what it is replacing until it has
      // something to replace it with.
      return { ...state, token: action.token, loading: true, error: null }

    case 'resolved':
      if (action.token !== state.token) return state
      return {
        ...state,
        loading: false,
        loaded: true,
        items: action.response.items,
        truncated: action.response.truncated,
        scanned: action.response.scanned,
        error: null,
      }

    case 'failed':
      if (action.token !== state.token) return state
      // `loaded` is deliberately untouched: a failed reload of a list that was
      // already on screen is an error *about* that list, not the loss of it.
      return { ...state, loading: false, error: action.message }
  }
}
