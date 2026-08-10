'use server'

import { updateConfig } from '@/lib/store'

/**
 * Remember the destination project picked in the push panel, so the next
 * session starts on it.
 *
 * A mutation, so it is a Server Action rather than an `/api` route — same rule
 * as the settings forms. It deliberately does *not* call `refresh()`, unlike
 * those: the explorer keeps the selection in client state, and re-rendering the
 * whole page on every change of a dropdown would cost a round trip to show
 * something already on screen.
 *
 * A failed write is swallowed on purpose. This is a convenience — the choice
 * still works for the rest of the session, and a rejected promise in a
 * `onChange` handler would surface as an unhandled rejection in the browser
 * over a preference nobody asked to save.
 */
export async function saveLastProject(projectId: string | null): Promise<void> {
  const id = projectId?.trim() ?? ''
  try {
    updateConfig({ lastProjectId: id || null })
  } catch (err) {
    console.error('No se pudo guardar el último proyecto de Linear:', err)
  }
}
