'use client'

import { useActionState, useState } from 'react'

import { openFolderAction, type OpenFolderState } from './actions'

type Props = {
  /** The folder currently in use, or null when none has been opened yet. */
  contextRoot: string | null
  /** Most recent first, as stored by the config. */
  recentFolders: string[]
}

export function ContextFolderForm({ contextRoot, recentFolders }: Props) {
  const initialState: OpenFolderState = { folder: contextRoot ?? '', error: null, attempt: 0 }
  const [state, formAction, pending] = useActionState(openFolderAction, initialState)
  const [folder, setFolder] = useState(initialState.folder)
  const [seenAttempt, setSeenAttempt] = useState(initialState.attempt)

  // A recents button submits a path the input knows nothing about, so mirror
  // the attempt back into the field: it always shows the folder last tried,
  // whether that succeeded or failed.
  if (state.attempt !== seenAttempt) {
    setSeenAttempt(state.attempt)
    setFolder(state.folder)
  }

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <label htmlFor="folder" className="text-sm font-medium">
          Carpeta de contexto
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="folder"
            name="folder"
            type="text"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="/Users/tu-usuario/notas"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={state.error !== null}
            aria-describedby={state.error ? 'folder-error' : undefined}
            className="flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-content outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
          >
            {pending ? 'Abriendo…' : 'Abrir'}
          </button>
        </div>

        <p className="text-sm text-muted">
          Ruta absoluta de la carpeta con tus transcripciones en Markdown.
        </p>

        {state.error ? (
          <p id="folder-error" role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}

        {contextRoot ? (
          <p className="text-sm text-muted">
            Carpeta activa:{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.9em]">
              {contextRoot}
            </code>
          </p>
        ) : (
          <p className="text-sm text-muted">
            Todavía no hay ninguna carpeta configurada.
          </p>
        )}
      </section>

      {recentFolders.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Recientes</h2>
          <ul className="flex flex-col gap-1">
            {recentFolders.map((recent) => {
              const active = recent === contextRoot
              return (
                <li key={recent}>
                  {/* Submits the same form with its own path — see openFolderAction. */}
                  <button
                    type="submit"
                    name="recent"
                    value={recent}
                    disabled={pending}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left font-mono text-sm transition-colors disabled:opacity-50 ${
                      active
                        ? 'border-accent bg-accent-wash text-content'
                        : 'border-transparent text-muted hover:bg-surface-2'
                    }`}
                  >
                    <span className="truncate">{recent}</span>
                    {active ? (
                      <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 font-sans text-xs font-medium text-on-accent">
                        Activa
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </form>
  )
}
