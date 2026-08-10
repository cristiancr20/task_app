'use server'

import { refresh } from 'next/cache'

import { describeError } from '@/lib/api'
import { openContextRoot } from '@/lib/context-root'
import { DEFAULT_OLLAMA_MODEL } from '@/lib/ollama'
import { getConfig, updateConfig, type Provider } from '@/lib/store'

/** What the settings form renders after an attempt to open a folder. */
export type OpenFolderState = {
  /** The path the last attempt used, so the input can keep showing it. */
  folder: string
  /** Spanish message shown inline, or null when the folder was opened. */
  error: string | null
  /**
   * Counts attempts. Two failures on the same path are otherwise
   * indistinguishable, and the form needs to know the state is fresh.
   */
  attempt: number
}

/**
 * Validate a folder and save it as the context root, or answer with an inline
 * error. Invoked by the text input's «Abrir» button and by every entry of the
 * recents list, which submits the same form.
 */
export async function openFolderAction(
  previous: OpenFolderState,
  formData: FormData,
): Promise<OpenFolderState> {
  // A recents button carries its own path and wins over whatever is typed.
  const folder = field(formData, 'recent') ?? field(formData, 'folder') ?? ''
  const attempt = previous.attempt + 1

  try {
    const config = openContextRoot(folder)
    // The page reads the config on the server, so it has to re-render for the
    // new active folder and the new recents list to show up.
    refresh()
    return { folder: config.contextRoot ?? folder, error: null, attempt }
  } catch (err) {
    return { folder, error: describeError(err, folder).message, attempt }
  }
}

/** What the provider form renders after an attempt to save. */
export type SaveProviderState = {
  /** Spanish message shown inline, or null when the settings were saved. */
  error: string | null
  /** True right after a successful save, so the form can confirm it. */
  saved: boolean
  /** Counts attempts — see `OpenFolderState.attempt`. */
  attempt: number
}

/**
 * Persist the extraction provider, the Ollama model and the Anthropic API key.
 *
 * The key is write-only from the browser's point of view: an empty field keeps
 * whatever is stored (the form only ever shows a masked placeholder), and the
 * «Borrar» button submits `intent=clear-claude-key` to erase it.
 */
export async function saveProviderAction(
  previous: SaveProviderState,
  formData: FormData,
): Promise<SaveProviderState> {
  const attempt = previous.attempt + 1
  const stored = getConfig()

  const provider: Provider = field(formData, 'provider') === 'claude' ? 'claude' : 'ollama'
  const ollamaModel =
    field(formData, 'ollamaModel')?.trim() || stored.ollamaModel || DEFAULT_OLLAMA_MODEL
  const typedKey = field(formData, 'claudeApiKey')?.trim() ?? ''
  const claudeApiKey =
    field(formData, 'intent') === 'clear-claude-key' ? '' : typedKey || stored.claudeApiKey

  try {
    updateConfig({ provider, ollamaModel, claudeApiKey })
    // The page reads the config on the server, so it has to re-render for the
    // saved provider and the API key's masked state to show up.
    refresh()
    return { error: null, saved: true, attempt }
  } catch (err) {
    return { error: describeError(err, '').message, saved: false, attempt }
  }
}

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  return typeof value === 'string' ? value : null
}
