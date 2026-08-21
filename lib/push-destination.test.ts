import { describe, expect, it } from 'vitest'

import {
  type Destination,
  destinationSettled,
  destinationSummary,
  excludedSummary,
  type ParentPlan,
  pendingSummary,
  pushBlockedBy,
  pushButtonLabel,
  pushOutcome,
} from '@/lib/push-destination'

/** A destination that is complete, so each test only says how it differs. */
function destination(overrides: Partial<Destination> = {}): Destination {
  return {
    status: 'ready',
    project: { id: 'p1', name: 'Plataforma' },
    parent: 'none',
    parentTitle: '',
    ...overrides,
  }
}

describe('destinationSettled', () => {
  it('is true with a project and no parent to name', () => {
    expect(destinationSettled(destination())).toBe(true)
  })

  it('is false while the listing has not landed', () => {
    expect(destinationSettled(destination({ status: 'loading', project: null }))).toBe(false)
    expect(destinationSettled(destination({ status: 'no-key', project: null }))).toBe(false)
    expect(destinationSettled(destination({ status: 'error', project: null }))).toBe(false)
  })

  it('is false with no project chosen', () => {
    expect(destinationSettled(destination({ project: null }))).toBe(false)
  })

  it('is false while a parent about to be created has no title', () => {
    expect(destinationSettled(destination({ parent: 'new', parentTitle: '   ' }))).toBe(false)
    expect(destinationSettled(destination({ parent: 'new', parentTitle: 'Comité' }))).toBe(true)
  })

  it('ignores the title once the parent exists, because a retry reuses it', () => {
    expect(destinationSettled(destination({ parent: 'existing', parentTitle: '' }))).toBe(true)
  })
})

describe('destinationSummary', () => {
  it('names the project and says there will be no parent', () => {
    expect(destinationSummary(destination())).toBe('A Plataforma · sin tarea padre')
  })

  it('names the parent it is about to create', () => {
    expect(destinationSummary(destination({ parent: 'new', parentTitle: 'Comité semanal' }))).toBe(
      'A Plataforma · bajo «Comité semanal»',
    )
  })

  it('says what is missing rather than pretending the destination is complete', () => {
    expect(destinationSummary(destination({ parent: 'new', parentTitle: ' ' }))).toBe(
      'A Plataforma · falta el título de la tarea padre',
    )
  })

  it('points at the parent a retry would reuse', () => {
    expect(destinationSummary(destination({ parent: 'existing' }))).toBe(
      'A Plataforma · bajo la tarea padre ya creada',
    )
  })

  it('does not call a workspace that is still loading «sin proyecto»', () => {
    expect(destinationSummary(destination({ status: 'loading', project: null }))).toBe(
      'Cargando el destino…',
    )
    expect(destinationSummary(destination({ status: 'no-key', project: null }))).toBe(
      'Sin API key de Linear',
    )
    expect(destinationSummary(destination({ status: 'error', project: null }))).toBe(
      'No se pudo cargar el destino',
    )
  })

  it('asks for a project once there is a workspace to pick one from', () => {
    expect(destinationSummary(destination({ project: null }))).toBe('Sin proyecto elegido')
  })
})

describe('pushBlockedBy', () => {
  /** A push that could run: one row to send, nothing created yet. */
  const gate = {
    destination: destination(),
    error: null,
    running: false,
    pending: 3,
    created: 0,
  }

  it('is null when everything is in place', () => {
    expect(pushBlockedBy(gate)).toBeNull()
  })

  it('asks for the key before the project', () => {
    expect(
      pushBlockedBy({ ...gate, destination: destination({ status: 'no-key', project: null }) }),
    ).toBe('No hay ninguna API key de Linear guardada.')
  })

  it('reports the listing that failed, with its own message when there is one', () => {
    const broken = destination({ status: 'error', project: null })
    expect(pushBlockedBy({ ...gate, destination: broken, error: 'Linear no responde.' })).toBe(
      'Linear no responde.',
    )
    expect(pushBlockedBy({ ...gate, destination: broken })).toBe(
      'No se pudieron cargar los proyectos de Linear.',
    )
  })

  it('asks for a project', () => {
    expect(pushBlockedBy({ ...gate, destination: destination({ project: null }) })).toBe(
      'Selecciona el proyecto de destino.',
    )
  })

  it('blocks itself while it runs', () => {
    expect(pushBlockedBy({ ...gate, running: true })).toBe('Creando las tareas en Linear…')
  })

  it('tells «nada marcado» apart from «ya está todo creado»', () => {
    expect(pushBlockedBy({ ...gate, pending: 0 })).toBe('Marca al menos una tarea para crearla.')
    expect(pushBlockedBy({ ...gate, pending: 0, created: 4 })).toBe(
      'Todas las tareas seleccionadas ya se han creado en Linear.',
    )
  })

  it('asks for the title of a parent it is about to create', () => {
    expect(
      pushBlockedBy({ ...gate, destination: destination({ parent: 'new', parentTitle: '  ' }) }),
    ).toBe('Escribe un título para la tarea padre.')
  })

  it('does not ask for a title once the parent exists', () => {
    expect(
      pushBlockedBy({ ...gate, destination: destination({ parent: 'existing', parentTitle: '' }) }),
    ).toBeNull()
  })

  it('answers one reason at a time, the first one to fix', () => {
    // Everything is wrong at once: no key, no project, no title, nothing marked.
    const missing = destination({ status: 'no-key', project: null, parent: 'new' })
    expect(pushBlockedBy({ ...gate, destination: missing, pending: 0 })).toBe(
      'No hay ninguna API key de Linear guardada.',
    )
  })
})

describe('pushButtonLabel', () => {
  it('creates when nothing has failed', () => {
    expect(pushButtonLabel({ running: false, pending: 3, failed: 0 })).toBe('Crear en Linear')
  })

  it('retries the failures, agreeing in number', () => {
    expect(pushButtonLabel({ running: false, pending: 1, failed: 1 })).toBe('Reintentar 1 fallida')
    expect(pushButtonLabel({ running: false, pending: 2, failed: 2 })).toBe('Reintentar 2 fallidas')
  })

  it('counts the rows an aborted run never attempted, not only the failures', () => {
    expect(pushButtonLabel({ running: false, pending: 5, failed: 2 })).toBe('Reintentar 5 pendientes')
  })

  it('says it is working while it works', () => {
    expect(pushButtonLabel({ running: true, pending: 5, failed: 0 })).toBe('Creando…')
  })
})

describe('pendingSummary', () => {
  it('agrees in number', () => {
    expect(pendingSummary(1, 'none')).toBe('1 tarea')
    expect(pendingSummary(4, 'none')).toBe('4 tareas')
  })

  it('says where the tasks will hang from', () => {
    expect(pendingSummary(3, 'new')).toBe('3 tareas bajo una tarea padre')
    expect(pendingSummary(3, 'existing')).toBe('3 tareas bajo la tarea padre')
  })

  it('covers every plan', () => {
    const plans: ParentPlan[] = ['none', 'new', 'existing']
    for (const plan of plans) expect(pendingSummary(2, plan)).toContain('2 tareas')
  })
})

describe('excludedSummary', () => {
  it('agrees in number', () => {
    expect(excludedSummary(1)).toBe('1 duplicada excluida')
    expect(excludedSummary(3)).toBe('3 duplicadas excluidas')
  })
})

describe('pushOutcome', () => {
  it('counts what was created', () => {
    expect(pushOutcome({ created: 1, failed: 0, underParent: false })).toBe('1 tarea creada')
    expect(pushOutcome({ created: 3, failed: 0, underParent: false })).toBe('3 tareas creadas')
  })

  it('names the parent only when something hangs from it', () => {
    expect(pushOutcome({ created: 3, failed: 0, underParent: true })).toBe(
      '3 tareas creadas bajo la tarea padre',
    )
    expect(pushOutcome({ created: 0, failed: 2, underParent: true })).toBe(
      '0 tareas creadas · 2 fallidas',
    )
  })

  it('adds the failures', () => {
    expect(pushOutcome({ created: 2, failed: 1, underParent: false })).toBe(
      '2 tareas creadas · 1 fallida',
    )
  })
})
