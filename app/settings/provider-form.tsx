'use client'

import { useActionState, useEffect, useState } from 'react'

import type { Provider } from '@/lib/store'

import { saveProviderAction, type SaveProviderState } from './actions'

type Props = {
  /** The stored provider; 'ollama' unless the user picked otherwise. */
  provider: Provider
  /** The stored Ollama model, preselected when it is still installed. */
  ollamaModel: string
  /** Whether an Anthropic key is stored. The key itself never reaches the browser. */
  hasClaudeApiKey: boolean
  /** `DEFAULT_OLLAMA_MODEL` — the client cannot import the server-side module. */
  defaultModel: string
}

/** What `GET /api/ollama/models` answers on success. */
type ModelsResponse = { url: string; models: string[] }

export function ProviderForm({ provider, ollamaModel, hasClaudeApiKey, defaultModel }: Props) {
  const initialState: SaveProviderState = { error: null, saved: false, attempt: 0 }
  const [state, formAction, pending] = useActionState(saveProviderAction, initialState)

  const [selected, setSelected] = useState<Provider>(provider)
  const [model, setModel] = useState(ollamaModel || defaultModel)
  const [apiKey, setApiKey] = useState('')
  const [seenAttempt, setSeenAttempt] = useState(initialState.attempt)

  // The typed key is saved (or deliberately cleared) once the action answers;
  // keeping it in the field afterwards would only invite a double submit.
  if (state.attempt !== seenAttempt) {
    setSeenAttempt(state.attempt)
    if (state.saved) setApiKey('')
  }

  const { models, error: modelsError, loading, reload } = useOllamaModels(selected === 'ollama')

  // Ollama is the source of truth for what can actually run: keep the stored
  // model if it is still installed, otherwise fall back to the suggested one.
  useEffect(() => {
    if (!models || models.length === 0) return
    setModel((current) => pickModel(models, current, defaultModel))
  }, [models, defaultModel])

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Motor de extracción</legend>

        <label
          className={`flex cursor-pointer gap-3 rounded-md border p-3 transition-colors ${
            selected === 'ollama'
              ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-300 dark:bg-zinc-900'
              : 'border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900'
          }`}
        >
          <input
            type="radio"
            name="provider"
            value="ollama"
            checked={selected === 'ollama'}
            onChange={() => setSelected('ollama')}
            className="mt-1 accent-zinc-900 dark:accent-zinc-100"
          />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">Ollama (local, gratis)</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Usa un modelo instalado en tu máquina. Nada sale de tu ordenador.
            </span>
          </span>
        </label>

        {selected === 'ollama' ? (
          <div className="ml-7 flex flex-col gap-2">
            <label htmlFor="ollamaModel" className="text-sm font-medium">
              Modelo
            </label>

            {loading && !models ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Buscando modelos…</p>
            ) : models && models.length > 0 ? (
              <select
                id="ollamaModel"
                name="ollamaModel"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-500 sm:max-w-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500"
              >
                {models.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              // Unreachable and «nothing pulled yet» lead to the same fix.
              <div id="ollama-models-empty" className="flex flex-col gap-2">
                <p className="text-sm text-amber-700 dark:text-amber-500">
                  {modelsError ? `${modelsError} ` : 'Ollama no tiene ningún modelo instalado. '}
                  Instala uno con{' '}
                  <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
                    ollama pull {defaultModel}
                  </code>
                  .
                </p>
                <button
                  type="button"
                  onClick={reload}
                  disabled={loading}
                  className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  {loading ? 'Buscando…' : 'Reintentar'}
                </button>
              </div>
            )}
          </div>
        ) : null}

        <label
          className={`flex cursor-pointer gap-3 rounded-md border p-3 transition-colors ${
            selected === 'claude'
              ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-300 dark:bg-zinc-900'
              : 'border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900'
          }`}
        >
          <input
            type="radio"
            name="provider"
            value="claude"
            checked={selected === 'claude'}
            onChange={() => setSelected('claude')}
            className="mt-1 accent-zinc-900 dark:accent-zinc-100"
          />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">Claude API (de pago)</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Mejor calidad de extracción, con coste por uso.
            </span>
            <strong className="text-sm font-medium text-amber-700 dark:text-amber-500">
              Aviso: el uso se factura por tokens contra tu cuenta de la API de Anthropic. NO está
              incluido en una suscripción de Claude Pro o Max.
            </strong>
          </span>
        </label>

        {selected === 'claude' ? (
          <div className="ml-7 flex flex-col gap-2">
            <label htmlFor="claudeApiKey" className="text-sm font-medium">
              API key de Anthropic
            </label>
            <input
              id="claudeApiKey"
              name="claudeApiKey"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasClaudeApiKey ? '•••••••••• (guardada)' : 'sk-ant-…'}
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 sm:max-w-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500"
            />
            {hasClaudeApiKey ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                Hay una clave guardada. Escribe otra para reemplazarla.
                <button
                  type="submit"
                  name="intent"
                  value="clear-claude-key"
                  disabled={pending}
                  className="rounded-md border border-zinc-300 px-2 py-0.5 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  Borrar
                </button>
              </p>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Necesitas una clave para extraer con Claude. Se guarda sin cifrar en la carpeta
                local <code className="font-mono">.data</code>.
              </p>
            )}
          </div>
        ) : null}
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? 'Guardando…' : 'Guardar'}
        </button>

        {state.error ? (
          <p id="provider-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        ) : state.saved && !pending ? (
          <p id="provider-saved" className="text-sm text-zinc-600 dark:text-zinc-400">
            Guardado.
          </p>
        ) : null}
      </div>
    </form>
  )
}

/**
 * The installed models, fetched from the browser only while Ollama is the
 * selected provider — the settings page then renders without waiting for a
 * server that may not be running, and «Reintentar» costs no reload.
 */
function useOllamaModels(enabled: boolean) {
  const [models, setModels] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const response = await fetch('/api/ollama/models', { cache: 'no-store' })
        const body: unknown = await response.json()
        if (cancelled) return

        if (!response.ok) {
          setModels([])
          setError(errorMessage(body))
          return
        }
        setModels((body as ModelsResponse).models ?? [])
        setError(null)
      } catch {
        if (cancelled) return
        setModels([])
        setError('No se pudo consultar la lista de modelos de Ollama.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, attempt])

  return { models, error, loading, reload: () => setAttempt((it) => it + 1) }
}

/** Keep the stored model when it is installed, else prefer the suggested one. */
function pickModel(models: string[], current: string, fallback: string): string {
  if (models.includes(current)) return current
  if (models.includes(fallback)) return fallback
  return models[0] ?? current
}

function errorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string' && error) return error
  }
  return 'No se pudo consultar la lista de modelos de Ollama.'
}
