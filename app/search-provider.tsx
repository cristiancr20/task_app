'use client'

import { createContext, type ReactNode, useContext } from 'react'

import { type SearchApi, useSearch } from './use-search'

const SearchContext = createContext<SearchApi | null>(null)

/**
 * One search, shared by the two places on the page that are about it: the
 * field lives in the header, above the explorer and outside it, and the
 * results are drawn inside the explorer, in the column the folder's files
 * normally occupy.
 *
 * A context rather than props because the header is written in `page.tsx`,
 * which is a Server Component: it cannot hold the state, and threading it
 * through would mean turning the whole header — the app mark, the path, the
 * theme control — into client code for the sake of one input. The provider is
 * the only client boundary needed; everything it wraps, server-rendered or
 * not, keeps rendering exactly where it did.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const search = useSearch()

  return <SearchContext value={search}>{children}</SearchContext>
}

/**
 * The shared search. It throws outside the provider rather than handing back a
 * dead object: a field that quietly does nothing is much harder to notice than
 * a page that does not render.
 */
export function useSearchApi(): SearchApi {
  const search = useContext(SearchContext)
  if (!search) throw new Error('useSearchApi debe usarse dentro de <SearchProvider>.')
  return search
}
