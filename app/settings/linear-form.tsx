'use client'

import { useActionState, useState } from 'react'

import { saveLinearKeyAction, type SaveLinearKeyState } from './actions'

type Props = {
  /** Whether a Linear key is stored. The key itself never reaches the browser. */
  hasLinearApiKey: boolean
}

/** What `GET /api/linear/verify` answers on success. */
type VerifyResponse = { organization: { name: string; urlKey: string } }

/** The outcome of the last «Probar», or null while none has run. */
type VerifyState = { workspace: string } | { error: string }

export function LinearForm({ hasLinearApiKey }: Props) {
  const initialState: SaveLinearKeyState = { error: null, saved: false, attempt: 0 }
  const [state, formAction, pending] = useActionState(saveLinearKeyAction, initialState)

  const [apiKey, setApiKey] = useState('')
  const [seenAttempt, setSeenAttempt] = useState(initialState.attempt)
  const [verify, setVerify] = useState<VerifyState | null>(null)
  const [verifying, setVerifying] = useState(false)

  // A save replaces the key the last check ran against, so its verdict no
  // longer describes what is stored. Clearing the field avoids a double submit.
  if (state.attempt !== seenAttempt) {
    setSeenAttempt(state.attempt)
    if (state.saved) {
      setApiKey('')
      setVerify(null)
    }
  }

  // Probing checks the *stored* key, so an unsaved edit would report on the
  // wrong one — the button waits until there is nothing pending to save.
  const unsaved = apiKey.trim() !== ''
  const canVerify = hasLinearApiKey && !unsaved && !pending

  async function runVerify() {
    setVerifying(true)
    try {
      const response = await fetch('/api/linear/verify', { cache: 'no-store' })
      const body: unknown = await response.json()

      if (!response.ok) {
        setVerify({ error: errorMessage(body) })
        return
      }
      setVerify({ workspace: (body as VerifyResponse).organization.name })
    } catch {
      setVerify({ error: 'No se pudo contactar con el servidor de la aplicación.' })
    } finally {
      setVerifying(false)
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Linear</h2>
        <p className="text-sm text-muted">
          La API key con la que la app creará las incidencias. Créala en Linear, en{' '}
          <span className="whitespace-nowrap">Settings → Security &amp; access → API keys</span>.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="linearApiKey" className="text-sm font-medium">
          API key de Linear
        </label>
        <input
          id="linearApiKey"
          name="linearApiKey"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={hasLinearApiKey ? '•••••••••• (guardada)' : 'lin_api_…'}
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-content outline-none placeholder:text-muted focus:border-accent sm:max-w-sm"
        />

        <p className="text-sm text-muted">
          {hasLinearApiKey
            ? 'Hay una clave guardada. Escribe otra para reemplazarla. '
            : 'Necesitas una clave para crear incidencias en Linear. '}
          Se guarda <strong className="font-medium">sin cifrar</strong> en la carpeta local{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.9em]">
            .data
          </code>{' '}
          de este proyecto.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Guardar'}
        </button>

        <button
          type="button"
          onClick={runVerify}
          disabled={!canVerify || verifying}
          title={unsaved ? 'Guarda la clave antes de probarla.' : undefined}
          className="rounded-md border border-line-strong px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {verifying ? 'Probando…' : 'Probar'}
        </button>

        {hasLinearApiKey ? (
          <button
            type="submit"
            name="intent"
            value="clear-linear-key"
            disabled={pending}
            className="rounded-md border border-line-strong px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Borrar
          </button>
        ) : null}
      </div>

      {state.error ? (
        <p id="linear-error" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : state.saved && !pending ? (
        <p id="linear-saved" className="text-sm text-muted">
          Guardado.
        </p>
      ) : null}

      {unsaved ? (
        <p id="linear-verify-hint" className="text-sm text-muted">
          Guarda la clave para poder probarla.
        </p>
      ) : verify && 'workspace' in verify ? (
        <p id="linear-verify-ok" className="text-sm text-ok">
          Conectado al espacio de trabajo «{verify.workspace}».
        </p>
      ) : verify ? (
        <p id="linear-verify-error" role="alert" className="text-sm text-danger">
          {verify.error}
        </p>
      ) : null}
    </form>
  )
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudo verificar la API key de Linear.'
}
