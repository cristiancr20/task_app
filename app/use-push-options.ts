'use client'

import { useCallback, useState } from 'react'

/** What the push does beyond creating the checked rows. */
export type PushOptions = {
  /** Group the tasks under one parent issue. On by default. */
  createParent: boolean
  /**
   * The parent's title, or null while the user has not touched it — which is
   * what lets the field track the transcript's own title, including the moment
   * it arrives (the note is read asynchronously, so at first paint there is no
   * title to copy yet). Typing stores a string, even an empty one, so clearing
   * the field is respected rather than re-filled.
   */
  parentTitle: string | null
}

const DEFAULT: PushOptions = { createParent: true, parentTitle: null }

/**
 * The push options of every transcript visited since the page loaded.
 *
 * Keyed by path for the same reason as the drafts: the panel is not unmounted
 * when the selection changes, so a plain `useState` would carry one note's
 * parent title over to the next one and offer to file the wrong meeting.
 */
export function usePushOptions(relPath: string | null): {
  options: PushOptions
  setCreateParent: (value: boolean) => void
  setParentTitle: (value: string) => void
} {
  const [byPath, setByPath] = useState<Record<string, PushOptions>>({})

  const patch = useCallback(
    (change: (previous: PushOptions) => PushOptions) => {
      if (!relPath) return
      setByPath((previous) => ({ ...previous, [relPath]: change(previous[relPath] ?? DEFAULT) }))
    },
    [relPath],
  )

  const setCreateParent = useCallback(
    (value: boolean) => patch((previous) => ({ ...previous, createParent: value })),
    [patch],
  )

  const setParentTitle = useCallback(
    (value: string) => patch((previous) => ({ ...previous, parentTitle: value })),
    [patch],
  )

  return {
    options: (relPath ? byPath[relPath] : undefined) ?? DEFAULT,
    setCreateParent,
    setParentTitle,
  }
}
