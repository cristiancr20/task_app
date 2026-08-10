'use server'

import { refresh } from 'next/cache'

import { describeError } from '@/lib/api'
import { openContextRoot } from '@/lib/context-root'

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

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  return typeof value === 'string' ? value : null
}
