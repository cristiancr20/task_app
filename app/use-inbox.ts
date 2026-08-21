'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { type FilteredFiles, filterFiles } from '@/lib/file-filter'
import { inboxCounts, type InboxCounts, type InboxItem } from '@/lib/inbox'
import { fetchInbox } from '@/lib/inbox-client'
import {
  deselectVisible,
  EMPTY_SELECTION,
  MAX_BATCH_SELECTION,
  pruneSelection,
  type Selection,
  selectedItems,
  type SelectionSummary,
  selectionSummary,
  selectVisible,
  toggleSelected,
} from '@/lib/inbox-selection'
import { INITIAL_INBOX, inboxReducer, type InboxState } from '@/lib/inbox-state'

/** The chosen notes, as the view and the action bar use them. */
export type InboxSelectionApi = {
  /** The chosen `relPath`s. The rows are looked up from this. */
  paths: Selection
  /** Counts, the state of the master checkbox and whether the tanda is full. */
  summary: SelectionSummary
  /** The chosen rows, in the order the list has them — what a batch will run. */
  items: InboxItem[]
  /** The ceiling, so the interface can say the number it is enforcing. */
  max: number
  /** Tick or untick one row. Ticking does nothing once the tanda is full. */
  toggle: (relPath: string) => void
  /** «Seleccionar todo» / «no seleccionar todo», over the *visible* rows only. */
  toggleVisible: () => void
  /** «No seleccionar nada»: the whole tanda, filter or no filter. */
  clear: () => void
}

export type InboxApi = {
  /** Whether the inbox is the view on screen instead of the explorer's columns. */
  open: boolean
  show: () => void
  hide: () => void
  state: InboxState
  /** How many are pending, and how many of those are already extracted. */
  counts: InboxCounts
  /** What the inbox's own filter strip holds. Narrows the rows already loaded. */
  filter: string
  setFilter: (value: string) => void
  /** The rows the filter leaves on screen, and how many there were before it. */
  filtered: FilteredFiles<InboxItem>
  /** Which of those rows are chosen — see `lib/inbox-selection.ts`. */
  selection: InboxSelectionApi
  /** Walk the disk again — the reload button, and «Reintentar» after a failure. */
  reload: () => void
}

/**
 * The inbox as the whole page shares it: the button in the header opens it and
 * shows how many notes are pending, the view inside the explorer draws them,
 * and both are the same hook — see `app/inbox-provider.tsx`.
 *
 * It loads once on mount rather than on first open, because the count is part
 * of the header: a button that says «Bandeja» and only learns the number after
 * being pressed cannot tell the user there is anything waiting. The request is
 * cheap on the server — one cached walk, no transcript bodies — and it warms
 * the very index the search is about to use.
 *
 * Reloading forces the walk (`refresh`), which is the whole point of the
 * button: the index is there so the app does not re-read the disk, and this is
 * the one moment the user is explicitly asking it to.
 *
 * The filter and the selection live here rather than inside the view for one
 * reason: leaving the inbox has to clear them, and leaving is `hide()`, which
 * the header button and the search both call. State kept in the view would
 * survive as long as the component did and come back on the next open — a
 * selection nobody remembers making, over rows that may no longer be pending.
 */
export function useInbox(): InboxApi {
  const [open, setOpen] = useState(false)
  const [state, dispatch] = useReducer(inboxReducer, INITIAL_INBOX)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Selection>(EMPTY_SELECTION)
  /** The request that left last. Its answer is the only one worth writing. */
  const token = useRef(0)

  const load = useCallback((refresh: boolean) => {
    const round = ++token.current
    dispatch({ type: 'started', token: round })

    fetchInbox({ refresh }).then(
      (response) => dispatch({ type: 'resolved', token: round, response }),
      (err: unknown) => dispatch({ type: 'failed', token: round, message: errorMessage(err) }),
    )
  }, [])

  // The first read serves the index rather than forcing a walk: on a page load
  // there is nothing to suspect is stale yet.
  useEffect(() => {
    load(false)
  }, [load])

  // A reload can take notes out of the inbox — a push is exactly that — so the
  // selection is trimmed to what is still there. Done while rendering, like
  // the file list's filter: React re-runs the component before committing, so
  // the bar never counts, even for a frame, a note that is no longer pending.
  const [selectedFor, setSelectedFor] = useState(state.items)
  if (selectedFor !== state.items) {
    setSelectedFor(state.items)
    setSelected((current) => pruneSelection(current, state.items))
  }

  const counts = useMemo(() => inboxCounts(state.items), [state.items])
  // Filtering is arithmetic over the rows already loaded — the same module the
  // file list uses, so «sin mayúsculas ni acentos» means one thing in the app.
  const filtered = useMemo(() => filterFiles(state.items, filter), [state.items, filter])
  const visible = filtered.files
  const summary = useMemo(() => selectionSummary(selected, visible), [selected, visible])
  const chosen = useMemo(() => selectedItems(state.items, selected), [state.items, selected])

  const toggle = useCallback((relPath: string) => {
    setSelected((current) => toggleSelected(current, relPath))
  }, [])

  // One checkbox with two meanings, and both of them stop at the filter: with
  // rows hidden, «todo» is what is on screen — never the ones that are not.
  const toggleVisible = useCallback(() => {
    setSelected((current) =>
      selectionSummary(current, visible).allVisibleSelected
        ? deselectVisible(current, visible)
        : selectVisible(current, visible),
    )
  }, [visible])

  const clear = useCallback(() => setSelected(EMPTY_SELECTION), [])

  const show = useCallback(() => setOpen(true), [])
  // Leaving the view is what clears the tanda: a selection is a thing being
  // acted on right now, and coming back to a bandeja that still remembers
  // twelve ticked rows would be a batch nobody asked for waiting to be run.
  const hide = useCallback(() => {
    setOpen(false)
    setFilter('')
    setSelected(EMPTY_SELECTION)
  }, [])
  const reload = useCallback(() => load(true), [load])

  const selection = useMemo<InboxSelectionApi>(
    () => ({
      paths: selected,
      summary,
      items: chosen,
      max: MAX_BATCH_SELECTION,
      toggle,
      toggleVisible,
      clear,
    }),
    [chosen, clear, selected, summary, toggle, toggleVisible],
  )

  return { open, show, hide, state, counts, filter, setFilter, filtered, selection, reload }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'No se pudo leer la bandeja de entrada.'
}
