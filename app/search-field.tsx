'use client'

import { useRef } from 'react'

import { useSearchApi } from './search-provider'

/**
 * The search field of the header: one input, reachable from anywhere in the
 * explorer because the header never goes away.
 *
 * It is a plain controlled input rather than a form: there is nothing to
 * submit, since the query is sent on its own once the typing stops (see
 * `useSearch`). Escape empties it — the fastest way back to the folder — and
 * only then gives the focus up, so a stray Escape does not cost the field its
 * place under the cursor.
 */
export function SearchField() {
  const { query, setQuery, clear, state } = useSearchApi()
  const input = useRef<HTMLInputElement>(null)

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return
    // `type="search"` clears itself on Escape in some browsers, and React
    // would never hear about it: doing it here is what keeps the field and the
    // query the same string.
    event.preventDefault()
    if (query) {
      clear()
    } else {
      input.current?.blur()
    }
  }

  return (
    <div className="relative w-full max-w-sm">
      <SearchIcon />
      <input
        ref={input}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Buscar en las notas…"
        aria-label="Buscar en las notas"
        // The panel is the search's own output, so it is announced from there
        // rather than from here; the field only says what it is for.
        spellCheck={false}
        autoComplete="off"
        // `type="search"` draws a clear button of its own in WebKit, and it is
        // both unstyled and out of step with the one below it.
        className="w-full rounded-lg border border-line-strong bg-surface py-1.5 pl-8 pr-8 text-sm text-content outline-none placeholder:text-muted focus:border-accent [&::-webkit-search-cancel-button]:appearance-none"
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            clear()
            // Clearing is a step *inside* the search, not a way out of it: the
            // cursor stays where the next query is typed.
            input.current?.focus()
          }}
          title="Vaciar la búsqueda (Esc)"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition-colors hover:bg-line hover:text-content"
        >
          <span className="sr-only">Vaciar la búsqueda</span>
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      ) : null}
      {/* Whether something is on its way, in the field itself: the panel says
          it too, but the field is where the user is looking while typing. */}
      {state.status === 'searching' ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-8 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border-2 border-line-strong border-t-accent"
        />
      ) : null}
    </div>
  )
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  )
}
