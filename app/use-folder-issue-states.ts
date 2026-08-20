'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import type { FileView } from '@/lib/browse-client'
import { fetchFolderIssueStates } from '@/lib/issue-states-client'
import type { IssueState } from '@/lib/linear'

/** Nothing known about any note of this folder — the badges read as they always did. */
const NONE: Record<string, IssueState[]> = {}

/**
 * What became of the issues of every already-pushed note of the folder on
 * screen, by note path.
 *
 * The list draws a badge per row, so this is the one hook of the explorer that
 * is about a *folder* rather than about the open note: one request answers every
 * row of the panel, and asking per row would mean a burst of round trips — and
 * of Linear queries — every time somebody clicks another folder.
 *
 * It is a cache like the others, keyed by folder path and living as long as the
 * page: browsing back to a folder shows its badges complete, without a second
 * round trip. What the request was computed from — the notes and how many issues
 * each of them created — is inside the key, so a push in the folder on screen
 * invalidates it by itself, exactly as the ids do in `useIssueStates`.
 *
 * Unlike the report inside a note, this one has no failure to show: a badge has
 * no room for a message and no room for a «Reintentar», and the row is still
 * telling the truth without it. A folder that cannot be asked about — no key, no
 * pushed note — and a folder whose query failed both leave every badge saying
 * what it said before this feature existed.
 *
 * There is no polling either: the list is a place to choose from, not a report
 * to watch, and the open note already refreshes itself once a minute.
 */
export function useFolderIssueStates({
  folder,
  files,
  hasLinearApiKey,
}: {
  /** Root-relative path of the selected folder — `''` is the context root. */
  folder: string
  /** The rows on screen, or an empty list while the listing is not ready. */
  files: readonly FileView[]
  /** Whether a key is stored. The key itself never reaches the browser. */
  hasLinearApiKey: boolean
}): Record<string, IssueState[]> {
  const [byFolder, setByFolder] = useState<Record<string, Record<string, IssueState[]>>>({})
  /** Rounds already asked for, so a re-render does not re-ask. */
  const requested = useRef<Set<string>>(new Set())
  /** The newest round per folder, so an older answer never lands over it. */
  const latest = useRef<Map<string, string>>(new Map())

  // Only the notes that produced something are worth asking about, and how many
  // issues each of them produced is what makes the answer stale when it changes.
  const { paths, signature } = useMemo(() => {
    const pushed = files.filter((file) => file.pushed)
    return {
      paths: pushed.map((file) => file.relPath),
      signature: pushed.map((file) => `${file.relPath}=${file.pushed?.issues}`).join('|'),
    }
  }, [files])

  const enabled = hasLinearApiKey && paths.length > 0
  const requestKey = enabled ? `${folder}\n${signature}` : null

  useEffect(() => {
    if (!requestKey || requested.current.has(requestKey)) return
    requested.current.add(requestKey)
    latest.current.set(folder, requestKey)

    fetchFolderIssueStates(paths).then(
      (states) => {
        // Two rounds for the same folder overlap when a push lands while the
        // first is still in flight; only the newest may be written.
        if (latest.current.get(folder) !== requestKey) return
        setByFolder((previous) => ({ ...previous, [folder]: states }))
      },
      () => {
        // Deliberately silent: see the note above. The badges keep saying what
        // the history alone says, which is what they said before Linear was
        // ever asked.
      },
    )
  }, [folder, paths, requestKey])

  // The last answer for this folder, even when a newer round is in flight over
  // it: it is about these very notes and can only be out of date, never about
  // somebody else's folder. Dropping it while the next answer travels would
  // blink every badge in the list back to its shorter form.
  return byFolder[folder] ?? NONE
}
