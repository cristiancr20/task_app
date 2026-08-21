'use client'

import { createContext, type ReactNode, useContext, useEffect } from 'react'

import { useSearchApi } from './search-provider'
import { type InboxApi, useInbox } from './use-inbox'

const InboxContext = createContext<InboxApi | null>(null)

/**
 * One inbox, shared by the two places on the page that are about it: the button
 * lives in the header — where it also carries the count of pending notes — and
 * the list is drawn inside the explorer, in place of its columns.
 *
 * A context rather than props, for the same reason the search has one: the
 * header is written in `page.tsx`, a Server Component, and threading state
 * through it would turn the whole header into client code for the sake of one
 * button. See `app/search-provider.tsx`.
 *
 * It sits *inside* the search's provider because the two take turns over the
 * same column, and the rule has to hold both ways round: the button empties the
 * field when the inbox is opened, and typing in the field closes the inbox. An
 * inbox left open behind a search would come back the moment the query was
 * cleared, and its button would meanwhile claim to be showing something that is
 * not on screen.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const inbox = useInbox()
  const { active } = useSearchApi()
  const { open, hide } = inbox

  useEffect(() => {
    if (active && open) hide()
  }, [active, hide, open])

  return <InboxContext value={inbox}>{children}</InboxContext>
}

/**
 * The shared inbox. It throws outside the provider rather than handing back a
 * dead object: a button that quietly does nothing is much harder to notice
 * than a page that does not render.
 */
export function useInboxApi(): InboxApi {
  const inbox = useContext(InboxContext)
  if (!inbox) throw new Error('useInboxApi debe usarse dentro de <InboxProvider>.')
  return inbox
}
