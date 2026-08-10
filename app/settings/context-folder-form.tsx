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
            className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending ? 'Abriendo…' : 'Abrir'}
          </button>
        </div>

        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ruta absoluta de la carpeta con tus transcripciones en Markdown.
        </p>

        {state.error ? (
          <p id="folder-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        ) : null}

        {contextRoot ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Carpeta activa:{' '}
            <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
              {contextRoot}
            </code>
          </p>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
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
                        ? 'border-zinc-900 bg-zinc-100 text-zinc-900 dark:border-zinc-300 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'border-transparent text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <span className="truncate">{recent}</span>
                    {active ? (
                      <span className="shrink-0 rounded-full bg-zinc-900 px-2 py-0.5 font-sans text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
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
