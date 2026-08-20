'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import type { FileView } from '@/lib/browse-client'
import { fetchFolderHistory } from '@/lib/history-client'
import type { HistoryEntry } from '@/lib/store'

/** Nothing known about any note of this folder — no panel, no rows. */
const NONE: Record<string, HistoryEntry[]> = {}

/**
 * What every already-pushed note of the folder on screen sent to Linear, by
 * note path.
 *
 * The note being read carries its own history inside `useTranscript`; this is
 * the record of the meetings *around* it, which is the only place the pending
 * commitments of previous meetings can come from — their project, their issues
 * and their dates are in `config.json` and nowhere else the browser can see.
 *
 * It is shaped exactly like `useFolderIssueStates`, and deliberately so: same
 * folder key, same invalidation by «which notes, and how much each of them has
 * pushed», same cache for as long as the page lives, and the same silence on
 * failure. The two answers are read together — the states say what is still
 * open, the history says who promised it and when — so a difference in when
 * either of them arrives would show a panel that disagrees with the badges
 * beside it.
 *
 * It asks with no regard for the Linear key, unlike its counterpart: this is a
 * local file read, and the panel it feeds hides itself when the states that go
 * with it are missing. Making the read conditional on a credential it does not
 * use would only put the key check in two places.
 */
export function useFolderHistory({
  folder,
  files,
}: {
  /** Root-relative path of the selected folder — `''` is the context root. */
  folder: string
  /** The rows on screen, or an empty list while the listing is not ready. */
  files: readonly FileView[]
}): Record<string, HistoryEntry[]> {
  const [byFolder, setByFolder] = useState<Record<string, Record<string, HistoryEntry[]>>>({})
  /** Rounds already asked for, so a re-render does not re-ask. */
  const requested = useRef<Set<string>>(new Set())
  /** The newest round per folder, so an older answer never lands over it. */
  const latest = useRef<Map<string, string>>(new Map())

  // Only the notes that pushed something have a history to read, and how much
  // each of them pushed is what makes the answer stale when it changes.
  const { paths, signature } = useMemo(() => {
    const pushed = files.filter((file) => file.pushed)
    return {
      paths: pushed.map((file) => file.relPath),
      signature: pushed
        .map((file) => `${file.relPath}=${file.pushed?.pushes}:${file.pushed?.issues}`)
        .join('|'),
    }
  }, [files])

  const requestKey = paths.length > 0 ? `${folder}\n${signature}` : null

  useEffect(() => {
    if (!requestKey || requested.current.has(requestKey)) return
    requested.current.add(requestKey)
    latest.current.set(folder, requestKey)

    fetchFolderHistory(paths).then(
      (history) => {
        // Two rounds for the same folder overlap when a push lands while the
        // first is still in flight; only the newest may be written.
        if (latest.current.get(folder) !== requestKey) return
        setByFolder((previous) => ({ ...previous, [folder]: history }))
      },
      () => {
        // Deliberately silent, like the badges: the panel this feeds is an
        // addition to the note on screen, and a folder whose history could not
        // be read simply leaves it out rather than putting an error where a
        // reminder would have been.
      },
    )
  }, [folder, paths, requestKey])

  // The last answer for this folder, even while a newer round is in flight over
  // it: it is about these very notes and can only be out of date, never about
  // somebody else's folder.
  return byFolder[folder] ?? NONE
}
