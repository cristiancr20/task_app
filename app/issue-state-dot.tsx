import type { IssueStateGroup } from '@/lib/issue-state-summary'

/**
 * The colour of each state group, from the palette in `globals.css` and never
 * from a hex: `ok` for what is finished, `info` for what is moving, `muted` for
 * what nobody has touched. Cancelled is muted rather than red — the work was
 * dropped on purpose, which is news but not a problem to fix.
 *
 * It lives on its own because two panels read the same states side by side —
 * the note's own history and what previous meetings left open — and a dot that
 * meant one thing above and another below would be worse than no dot at all.
 */
const GROUP_DOT: Record<IssueStateGroup, string> = {
  completed: 'bg-ok',
  started: 'bg-info',
  unstarted: 'bg-muted',
  canceled: 'bg-muted',
}

/**
 * The dot next to a count or next to an issue. It is `aria-hidden` on purpose:
 * the state's own name is always written beside it, and a screen reader has no
 * use for the colour that repeats it.
 */
export function StateDot({ group }: { group: IssueStateGroup }) {
  return <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${GROUP_DOT[group]}`} />
}
