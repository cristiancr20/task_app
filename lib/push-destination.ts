/**
 * What the envío column says about itself: the one-line summary the destination
 * folds into, whether that destination is complete enough to fold it, the one
 * reason the button is disabled, and what the button reads.
 *
 * It lives here and not in `app/push-panel.tsx` because all of it is arithmetic
 * over the state of a push — the kind of decision the panel used to make inline,
 * where nothing could test it, and which is now read in two places at once: the
 * head of the column folds the destination, the foot of the column draws the
 * button. Two copies of «¿por qué no puedo enviar?» is exactly how the summary
 * and the button start disagreeing.
 *
 * It knows nothing about React, the filesystem, Linear or the network: it is
 * handed a plain description of the destination and of the run, and answers
 * strings. Every string it returns is user-facing, so every string is Spanish.
 */

/**
 * Where the workspace listing stands. `no-key` is not a failure: nothing was
 * ever requested. `app/use-push-target.ts` names its own status after this one,
 * so there is a single list of the states the column can be in.
 */
export type DestinationStatus = 'no-key' | 'loading' | 'ready' | 'error'

/**
 * Whether the tasks hang from a parent issue, and whose.
 *
 * `new` — the checkbox is on and the issue does not exist yet, so its title is
 * still something the user has to get right. `existing` — a previous run of
 * this note already created it and a retry hangs from that one instead of
 * filing a second copy of the meeting, which is why the title stops mattering.
 * `none` — the tasks go in loose.
 */
export type ParentPlan = 'none' | 'new' | 'existing'

/** The destination as the column reads it — the form's answer, not the form. */
export type Destination = {
  status: DestinationStatus
  /** The chosen project. Null while none is chosen, or while the listing is not in yet. */
  project: { id: string; name: string } | null
  parent: ParentPlan
  /** What the title field holds. Only ever read when `parent` is `new`. */
  parentTitle: string
}

/**
 * Whether there is nothing left to choose: a project, and a title whenever a
 * parent is about to be created.
 *
 * This is what decides whether the form starts folded. It is deliberately the
 * *same* condition the button gates on minus the rows — a destination the push
 * would refuse must never fold itself away, because the fields the user has to
 * fix would be the ones behind the fold.
 */
export function destinationSettled(destination: Destination): boolean {
  if (destination.status !== 'ready' || !destination.project) return false
  return destination.parent !== 'new' || destination.parentTitle.trim() !== ''
}

/**
 * The whole destination in one line: where this would go, and whether there
 * will be a parent issue over it.
 *
 * A status that is not `ready` says so instead of naming a project, because
 * there is no project to name and «Sin destino» over a workspace that is still
 * loading reads as a choice the user forgot to make.
 */
export function destinationSummary(destination: Destination): string {
  if (destination.status === 'no-key') return 'Sin API key de Linear'
  if (destination.status === 'loading') return 'Cargando el destino…'
  if (destination.status === 'error') return 'No se pudo cargar el destino'
  if (!destination.project) return 'Sin proyecto elegido'
  return `A ${destination.project.name} · ${parentNote(destination)}`
}

/** The half of the summary that is about the parent issue. */
function parentNote(destination: Destination): string {
  if (destination.parent === 'none') return 'sin tarea padre'
  if (destination.parent === 'existing') return 'bajo la tarea padre ya creada'
  const title = destination.parentTitle.trim()
  // Naming the missing title in the folded line is the only way the fold can
  // be honest about being incomplete — it is also why it does not fold yet.
  return title ? `bajo «${title}»` : 'falta el título de la tarea padre'
}

/** Everything the button's one reason is decided from. */
export type PushGate = {
  destination: Destination
  /** Message of the failed listing, in Spanish, or null. */
  error: string | null
  /** A run is in flight. */
  running: boolean
  /** Rows the button would send now: checked and not created yet. */
  pending: number
  /** Tasks already created for this note, parent aside. */
  created: number
}

/**
 * Why the push cannot run, or null when it can. Ordered by what the user has to
 * fix first: there is no point asking for a project while the key is missing,
 * and the project dropdown is empty until the listing lands.
 */
export function pushBlockedBy(gate: PushGate): string | null {
  const { destination } = gate
  if (destination.status === 'no-key') return 'No hay ninguna API key de Linear guardada.'
  if (destination.status === 'loading') return 'Cargando los proyectos de Linear…'
  if (destination.status === 'error')
    return gate.error ?? 'No se pudieron cargar los proyectos de Linear.'
  if (!destination.project) return 'Selecciona el proyecto de destino.'
  if (gate.running) return 'Creando las tareas en Linear…'
  if (gate.pending === 0) {
    // Nothing left is not the same as nothing chosen: after a clean run every
    // checked row exists in Linear, and offering to create them again is how
    // duplicates happen.
    return gate.created > 0
      ? 'Todas las tareas seleccionadas ya se han creado en Linear.'
      : 'Marca al menos una tarea para crearla.'
  }
  // Linear rejects an empty title, so the push would fail on the parent and
  // never reach the tasks. Once the parent exists this no longer applies.
  if (destination.parent === 'new' && !destination.parentTitle.trim())
    return 'Escribe un título para la tarea padre.'
  return null
}

/**
 * «Reintentar 2 fallidas» once a run left failures behind, «Crear en Linear»
 * otherwise. The number is always what the button is about to send, which is
 * not always the failures: a run that aborted left rows it never attempted, and
 * those go out too — naming only the failures would undercount the run the user
 * is starting.
 */
export function pushButtonLabel(run: { running: boolean; pending: number; failed: number }): string {
  if (run.running) return 'Creando…'
  if (run.failed === 0) return 'Crear en Linear'
  if (run.pending > run.failed) return `Reintentar ${run.pending} pendientes`
  return `Reintentar ${run.failed} fallida${run.failed === 1 ? '' : 's'}`
}

/**
 * «3 tareas bajo una tarea padre»: what the button is about to create, in the
 * head of the column, where it is readable without unfolding the destination.
 */
export function pendingSummary(pending: number, parent: ParentPlan): string {
  const tasks = `${pending} tarea${pending === 1 ? '' : 's'}`
  if (parent === 'new') return `${tasks} bajo una tarea padre`
  if (parent === 'existing') return `${tasks} bajo la tarea padre`
  return tasks
}

/**
 * «2 duplicadas excluidas», next to the count above. Without it the button and
 * the table disagree by however many the duplicate check took out, and nothing
 * on screen accounts for the difference.
 */
export function excludedSummary(excluded: number): string {
  return excluded === 1 ? '1 duplicada excluida' : `${excluded} duplicadas excluidas`
}

/** «3 tareas creadas bajo la tarea padre · 1 fallida», once the run is over. */
export function pushOutcome(run: {
  created: number
  failed: number
  underParent: boolean
}): string {
  const one = run.created === 1
  // With nothing created, the parent is not what the sentence is about.
  const created = `${run.created} tarea${one ? '' : 's'} creada${one ? '' : 's'}${
    run.underParent && run.created > 0 ? ' bajo la tarea padre' : ''
  }`
  return run.failed > 0
    ? `${created} · ${run.failed} fallida${run.failed === 1 ? '' : 's'}`
    : created
}
