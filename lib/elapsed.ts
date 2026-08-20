/**
 * How long ago something happened, in the words a meeting is run in.
 *
 * The pending-commitments panel has one column to say how long a task has been
 * open, and «hace 3 semanas» is the only form of that answer anybody acts on:
 * a full timestamp is precise about a thing nobody is precise about, and it
 * costs the row the width the title needs. The exact date is still one hover
 * away — the panel puts it in the `title` — so nothing is actually lost.
 *
 * It is here rather than inside the component for the usual reason: the suite
 * only collects `lib/**`, and this is arithmetic, not markup.
 */

const DAY_MS = 86_400_000

/**
 * `since` as «cuánto lleva», or `null` when it is not a date at all.
 *
 * The scale coarsens as it goes — days, then weeks, then months, then years —
 * because that is how the answer is used: three days late is a nudge, three
 * months late is a different conversation, and «hace 96 días» makes the reader
 * do the division. Months stop at eleven so the jump to «hace 1 año» is not
 * preceded by «hace 12 meses».
 *
 * `now` is passed in rather than read from the clock so the whole scale is
 * testable, and so a list rendered in one pass dates every row against the same
 * instant.
 *
 * A stamp in the future — a clock that disagrees with the one that wrote it —
 * reads as `hoy` rather than as a negative age: it is the smallest true thing
 * that can be said, and the alternative is a row that claims a meeting has not
 * happened yet. `null` is «no consta» and the caller leaves the column empty,
 * exactly as it does for a name nobody recorded; it is never rendered as a
 * zero.
 */
export function formatElapsed(since: string, now: number): string | null {
  const started = Date.parse(since)
  if (Number.isNaN(started)) return null

  const days = Math.floor(Math.max(0, now - started) / DAY_MS)

  if (days === 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} días`

  if (days < 30) return plural(Math.floor(days / 7), 'semana', 'semanas')
  if (days < 365) return plural(Math.min(11, Math.floor(days / 30)), 'mes', 'meses')
  return plural(Math.floor(days / 365), 'año', 'años')
}

/** «hace 1 semana», «hace 3 semanas» — the singular is never «1 semanas». */
function plural(count: number, one: string, many: string): string {
  return `hace ${count} ${count === 1 ? one : many}`
}
