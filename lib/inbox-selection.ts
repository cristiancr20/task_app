/**
 * Which notes of the inbox are chosen, as pure logic.
 *
 * A selection is a set of `relPath`s and nothing else — no rows, no React, no
 * order of its own — because the rows it points at come and go: the list is
 * reloaded, the filter narrows it, a push takes a note out of the inbox for
 * good. Keeping paths means every one of those events is a set operation here
 * instead of a special case in the view.
 *
 * Two rules are worth stating, because the whole story rests on them:
 *
 * - **«Seleccionar todo» is «seleccionar todo lo que se ve».** Every function
 *   that acts on a group takes the *visible* rows — what the filter left on
 *   screen — so a button labelled with what the user is looking at can never
 *   quietly reach the rows the filter is hiding.
 * - **A tanda has a ceiling.** `MAX_BATCH_SELECTION` is the most notes one
 *   batch may carry, and it is enforced *here*, on the way in, rather than
 *   trusted to the queue that will later process them. An add that would go
 *   past it returns the very same set, so the caller can compare by identity
 *   and the interface has a reason to explain the limit instead of a checkbox
 *   that silently refuses to tick.
 *
 * Every function returns the input set unchanged when it changes nothing, so a
 * no-op reconciles nothing in React.
 */

/** What a selection needs of a row: the path it is remembered by. */
export type SelectableNote = {
  relPath: string
}

/** The chosen notes, by `relPath`. */
export type Selection = ReadonlySet<string>

/**
 * The most notes one batch may carry.
 *
 * The batch these end up in is extracted **one note at a time** against a model
 * that may be running on the user's own machine — minutes per note, not
 * seconds — so the ceiling is not about memory but about how long a tanda a
 * person can reasonably start and wait for. Twenty-five notes is already a long
 * session; past that the honest answer is «haz esto en dos tandas», which is
 * what the interface says when the limit is reached.
 */
export const MAX_BATCH_SELECTION = 25

/** Nothing chosen — one shared empty set, so «vacío» is always the same object. */
export const EMPTY_SELECTION: Selection = new Set<string>()

/** Everything the action bar and the master checkbox need to draw themselves. */
export type SelectionSummary = {
  /** How many notes are chosen, visible or not. */
  count: number
  /** How many rows the filter is showing. */
  visible: number
  /** How many of those visible rows are chosen. */
  visibleSelected: number
  /** Every visible row is chosen, and there is at least one. */
  allVisibleSelected: boolean
  /** Some — but not all — visible rows are chosen: the indeterminate box. */
  someVisibleSelected: boolean
  /** How many more fit in this tanda. */
  remaining: number
  /** The tanda is full: nothing else can be added until something comes out. */
  atLimit: boolean
}

/**
 * How the selection stands against the rows currently on screen.
 *
 * `visibleSelected` is counted over the visible rows rather than over the set,
 * because that is the number the master checkbox is about: with a filter on,
 * «todas» means «todas las que se ven», and a set that also holds notes the
 * filter is hiding must not make the box look half-ticked.
 */
export function selectionSummary(
  selected: Selection,
  visible: readonly SelectableNote[],
  max: number = MAX_BATCH_SELECTION,
): SelectionSummary {
  let visibleSelected = 0
  for (const note of visible) {
    if (selected.has(note.relPath)) visibleSelected += 1
  }

  return {
    count: selected.size,
    visible: visible.length,
    visibleSelected,
    allVisibleSelected: visible.length > 0 && visibleSelected === visible.length,
    someVisibleSelected: visibleSelected > 0 && visibleSelected < visible.length,
    remaining: Math.max(0, max - selected.size),
    atLimit: selected.size >= max,
  }
}

/**
 * Tick or untick one row.
 *
 * Unticking always works — it is the way out of a full tanda — while ticking is
 * refused once the ceiling is reached, and refused by returning the same set:
 * the box the user pressed stays as it was and the bar goes on explaining why.
 */
export function toggleSelected(
  selected: Selection,
  relPath: string,
  max: number = MAX_BATCH_SELECTION,
): Selection {
  if (selected.has(relPath)) {
    const next = new Set(selected)
    next.delete(relPath)
    return next
  }

  if (selected.size >= max) return selected

  const next = new Set(selected)
  next.add(relPath)
  return next
}

/**
 * «Seleccionar todo»: add the rows on screen, in the order they are drawn,
 * until the tanda is full.
 *
 * It fills up to the ceiling instead of refusing the whole gesture, because a
 * user who presses «seleccionar todo» over forty rows wants a tanda started,
 * not nothing to happen — the bar then says how many went in and that the limit
 * is what stopped it. The rows are taken in the order given, so what gets in is
 * the top of the list the user is looking at, not an arbitrary subset.
 */
export function selectVisible(
  selected: Selection,
  visible: readonly SelectableNote[],
  max: number = MAX_BATCH_SELECTION,
): Selection {
  const next = new Set(selected)
  for (const note of visible) {
    if (next.size >= max) break
    next.add(note.relPath)
  }

  return next.size === selected.size ? selected : next
}

/**
 * Untick the rows on screen, leaving anything the filter is hiding alone.
 *
 * The counterpart of `selectVisible` and the second half of the master
 * checkbox. «No seleccionar nada» — the one in the action bar — is
 * `EMPTY_SELECTION`, and the difference between the two is deliberate: one is
 * about what is being looked at, the other about the whole tanda.
 */
export function deselectVisible(
  selected: Selection,
  visible: readonly SelectableNote[],
): Selection {
  if (selected.size === 0) return selected

  const next = new Set(selected)
  for (const note of visible) next.delete(note.relPath)

  return next.size === selected.size ? selected : next
}

/**
 * Drop whatever no longer exists in the list.
 *
 * The inbox reloads — on its own button, and whenever a push finishes — and a
 * note that has just been processed is gone from it. A selection that kept
 * pointing at it would carry a path into the batch that is no longer pending,
 * and the count in the bar would stop matching the ticked boxes.
 */
export function pruneSelection(selected: Selection, items: readonly SelectableNote[]): Selection {
  if (selected.size === 0) return selected

  const alive = new Set(items.map((item) => item.relPath))
  const next = new Set<string>()
  for (const relPath of selected) {
    if (alive.has(relPath)) next.add(relPath)
  }

  return next.size === selected.size ? selected : next
}

/**
 * The chosen rows, in the order the list has them.
 *
 * The set knows nothing about order, and the batch that will process these has
 * to run in the one the user sees — most recent first — so the list is the
 * source of the order and the set only says which.
 */
export function selectedItems<T extends SelectableNote>(
  items: readonly T[],
  selected: Selection,
): T[] {
  if (selected.size === 0) return []
  return items.filter((item) => selected.has(item.relPath))
}

/** `3 notas seleccionadas`: what the action bar leads with. */
export function selectionCountLabel(count: number): string {
  return count === 1 ? '1 nota seleccionada' : `${count} notas seleccionadas`
}

/** `Máximo 25 notas por tanda`: the ceiling, said with its number. */
export function selectionLimitLabel(max: number = MAX_BATCH_SELECTION): string {
  return `Máximo ${max} notas por tanda`
}
