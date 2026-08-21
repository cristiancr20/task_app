import { describe, expect, it } from 'vitest'

import type { QueueEvent, QueueNote } from '@/lib/extraction-queue'
import {
  applyQueueEvent,
  extractButtonLabel,
  extractedTasksLabel,
  INITIAL_QUEUE,
  queueBusy,
  queueProgressLabel,
  queueReducer,
  type QueueState,
  queueSummaryLabel,
  queueTally,
} from '@/lib/extraction-queue-state'

function notes(...names: string[]): QueueNote[] {
  return names.map((name) => ({ relPath: name, title: name.replace('.md', '') }))
}

/** The state a tanda over `names` starts from. */
function started(...names: string[]): QueueState {
  return queueReducer(INITIAL_QUEUE, { type: 'started', notes: notes(...names) })
}

/** Fold a run's events, as the hook does one dispatch at a time. */
function fold(state: QueueState, ...events: QueueEvent[]): QueueState {
  return events.reduce((current, event) => queueReducer(current, { type: 'event', event }), state)
}

const extracting = (relPath: string, index: number, total: number): QueueEvent => ({
  type: 'extracting',
  relPath,
  index,
  total,
  title: relPath.replace('.md', ''),
})

describe('INITIAL_QUEUE', () => {
  it('is no tanda at all', () => {
    expect(INITIAL_QUEUE).toEqual({
      status: 'idle',
      notes: [],
      results: {},
      progress: null,
      stopped: null,
    })
  })
})

describe('started', () => {
  it('keeps the notes in the order they will be processed', () => {
    expect(started('b.md', 'a.md').notes.map((note) => note.relPath)).toEqual(['b.md', 'a.md'])
  })

  it('forgets the previous tanda: its results were about other notes', () => {
    const finished = fold(
      started('a.md'),
      extracting('a.md', 1, 1),
      { type: 'failed', relPath: 'a.md', error: 'falló' },
      { type: 'done', extracted: 0, failed: 1, tasks: 0 },
    )

    const next = queueReducer(finished, { type: 'started', notes: notes('b.md') })
    expect(next.results).toEqual({})
    expect(next.stopped).toBeNull()
    expect(next.status).toBe('running')
  })
})

describe('applyQueueEvent', () => {
  it('leaves the state alone on start: the total is already the tanda', () => {
    const state = started('a.md', 'b.md')
    expect(applyQueueEvent(state, { type: 'start', total: 2 })).toBe(state)
  })

  it('marks the note being extracted and what the queue is on', () => {
    const state = fold(started('a.md', 'b.md'), extracting('b.md', 2, 2))

    expect(state.results['b.md']).toEqual({ state: 'extracting' })
    expect(state.progress).toEqual({ index: 2, total: 2, title: 'b' })
  })

  it('records how many tasks a finished note produced', () => {
    const state = fold(started('a.md'), extracting('a.md', 1, 1), {
      type: 'extracted',
      relPath: 'a.md',
      tasks: 4,
    })

    expect(state.results['a.md']).toEqual({ state: 'extracted', tasks: 4 })
  })

  it('marks a failed note with its own error and leaves the rest pending', () => {
    const state = fold(started('a.md', 'b.md'), extracting('a.md', 1, 2), {
      type: 'failed',
      relPath: 'a.md',
      error: 'Ollama no responde.',
    })

    expect(state.results['a.md']).toEqual({ state: 'failed', error: 'Ollama no responde.' })
    expect(state.results['b.md']).toBeUndefined()
    expect(state.status).toBe('running')
  })

  it('remembers why the run gave up', () => {
    const state = fold(started('a.md'), { type: 'stopped', reason: 'failures', error: 'tres seguidas' })
    expect(state.stopped).toEqual({ reason: 'failures', error: 'tres seguidas' })
  })

  it('finishes on done, with nothing in progress', () => {
    const state = fold(
      started('a.md'),
      extracting('a.md', 1, 1),
      { type: 'extracted', relPath: 'a.md', tasks: 1 },
      { type: 'done', extracted: 1, failed: 0, tasks: 1 },
    )

    expect(state.status).toBe('finished')
    expect(state.progress).toBeNull()
  })

  it('finishes a cancelled run too: half a tanda is still over', () => {
    const state = fold(
      started('a.md', 'b.md'),
      extracting('a.md', 1, 2),
      { type: 'extracted', relPath: 'a.md', tasks: 2 },
      { type: 'stopped', reason: 'cancelled', error: null },
      { type: 'done', extracted: 1, failed: 0, tasks: 2 },
    )

    expect(state.status).toBe('finished')
    expect(state.stopped).toEqual({ reason: 'cancelled', error: null })
    // What was extracted before the cancellation is kept, not undone.
    expect(state.results['a.md']).toEqual({ state: 'extracted', tasks: 2 })
    expect(state.results['b.md']).toBeUndefined()
  })
})

describe('cancelling', () => {
  it('is a state of its own while the note in flight finishes', () => {
    const state = queueReducer(fold(started('a.md', 'b.md'), extracting('a.md', 1, 2)), {
      type: 'cancelling',
    })

    expect(state.status).toBe('cancelling')
    expect(state.results['a.md']).toEqual({ state: 'extracting' })
  })

  it('does nothing to a run that already finished', () => {
    const finished = fold(started('a.md'), { type: 'done', extracted: 0, failed: 0, tasks: 0 })
    expect(queueReducer(finished, { type: 'cancelling' })).toBe(finished)
  })

  it('does nothing when there is no tanda', () => {
    expect(queueReducer(INITIAL_QUEUE, { type: 'cancelling' })).toBe(INITIAL_QUEUE)
  })
})

describe('crashed', () => {
  it('ends the run and blames the loop, not the note', () => {
    const state = queueReducer(fold(started('a.md', 'b.md'), extracting('a.md', 1, 2)), {
      type: 'crashed',
      error: 'La cola se interrumpió.',
    })

    expect(state.status).toBe('finished')
    expect(state.stopped).toEqual({ reason: 'error', error: 'La cola se interrumpió.' })
  })

  it('does not leave a note extracting for ever', () => {
    const state = queueReducer(fold(started('a.md'), extracting('a.md', 1, 1)), {
      type: 'crashed',
      error: 'La cola se interrumpió.',
    })

    expect(state.results['a.md']).toEqual({
      state: 'failed',
      error: 'Se interrumpió la cola mientras se extraía esta nota.',
    })
  })

  it('keeps the notes that had already landed', () => {
    const state = queueReducer(
      fold(
        started('a.md', 'b.md'),
        extracting('a.md', 1, 2),
        { type: 'extracted', relPath: 'a.md', tasks: 3 },
        extracting('b.md', 2, 2),
      ),
      { type: 'crashed', error: 'La cola se interrumpió.' },
    )

    expect(state.results['a.md']).toEqual({ state: 'extracted', tasks: 3 })
  })
})

describe('dismissed', () => {
  it('clears a finished tanda', () => {
    const finished = fold(started('a.md'), { type: 'done', extracted: 0, failed: 0, tasks: 0 })
    expect(queueReducer(finished, { type: 'dismissed' })).toBe(INITIAL_QUEUE)
  })

  it('cannot throw away a tanda that is still running', () => {
    const running = started('a.md')
    expect(queueReducer(running, { type: 'dismissed' })).toBe(running)
  })
})

describe('queueBusy', () => {
  it('is true while it runs and while it is being cancelled', () => {
    const running = started('a.md')
    expect(queueBusy(running)).toBe(true)
    expect(queueBusy(queueReducer(running, { type: 'cancelling' }))).toBe(true)
  })

  it('is false with no tanda and once it is over', () => {
    expect(queueBusy(INITIAL_QUEUE)).toBe(false)
    expect(
      queueBusy(fold(started('a.md'), { type: 'done', extracted: 0, failed: 0, tasks: 0 })),
    ).toBe(false)
  })
})

describe('queueTally', () => {
  it('counts nothing for no tanda', () => {
    expect(queueTally(INITIAL_QUEUE)).toEqual({
      total: 0,
      extracted: 0,
      failed: 0,
      tasks: 0,
      pending: 0,
    })
  })

  it('agrees with the run about how the tanda went', () => {
    const state = fold(
      started('a.md', 'b.md', 'c.md'),
      extracting('a.md', 1, 3),
      { type: 'extracted', relPath: 'a.md', tasks: 3 },
      extracting('b.md', 2, 3),
      { type: 'failed', relPath: 'b.md', error: 'falló' },
      extracting('c.md', 3, 3),
      { type: 'extracted', relPath: 'c.md', tasks: 2 },
      { type: 'done', extracted: 2, failed: 1, tasks: 5 },
    )

    expect(queueTally(state)).toEqual({ total: 3, extracted: 2, failed: 1, tasks: 5, pending: 0 })
  })

  it('counts what a cancellation never launched', () => {
    const state = fold(
      started('a.md', 'b.md', 'c.md'),
      extracting('a.md', 1, 3),
      { type: 'extracted', relPath: 'a.md', tasks: 1 },
      { type: 'stopped', reason: 'cancelled', error: null },
      { type: 'done', extracted: 1, failed: 0, tasks: 1 },
    )

    expect(queueTally(state)).toEqual({ total: 3, extracted: 1, failed: 0, tasks: 1, pending: 2 })
  })

  it('does not count the note in flight as pending', () => {
    const state = fold(started('a.md', 'b.md'), extracting('a.md', 1, 2))
    expect(queueTally(state).pending).toBe(1)
  })

  it('ignores results of notes that are not in this tanda', () => {
    const state = fold(started('a.md'), {
      type: 'extracted',
      relPath: 'otra.md',
      tasks: 9,
    })

    expect(queueTally(state)).toEqual({ total: 1, extracted: 0, failed: 0, tasks: 0, pending: 1 })
  })
})

describe('queueProgressLabel', () => {
  it('reads as the step it is on', () => {
    expect(queueProgressLabel({ index: 2, total: 5 })).toBe('Extrayendo 2 de 5')
  })
})

describe('queueSummaryLabel', () => {
  it('says the three numbers, zeros included', () => {
    expect(queueSummaryLabel({ total: 3, extracted: 3, failed: 0, tasks: 12, pending: 0 })).toBe(
      '3 extraídas · ninguna falló · 12 tareas',
    )
  })

  it('has a singular for each of them', () => {
    expect(queueSummaryLabel({ total: 2, extracted: 1, failed: 1, tasks: 1, pending: 0 })).toBe(
      '1 extraída · 1 falló · 1 tarea',
    )
  })

  it('says «ninguna tarea» rather than a zero', () => {
    expect(queueSummaryLabel({ total: 1, extracted: 1, failed: 0, tasks: 0, pending: 0 })).toBe(
      '1 extraída · ninguna falló · ninguna tarea',
    )
  })

  it('adds what was never launched, and only when there is some', () => {
    expect(queueSummaryLabel({ total: 5, extracted: 2, failed: 1, tasks: 7, pending: 2 })).toBe(
      '2 extraídas · 1 falló · 7 tareas · 2 sin lanzar',
    )
    expect(queueSummaryLabel({ total: 3, extracted: 2, failed: 0, tasks: 7, pending: 1 })).toBe(
      '2 extraídas · ninguna falló · 7 tareas · 1 sin lanzar',
    )
  })
})

describe('extractedTasksLabel', () => {
  it('counts the rows a note produced', () => {
    expect(extractedTasksLabel(5)).toBe('5 tareas')
    expect(extractedTasksLabel(1)).toBe('1 tarea')
  })

  it('words the empty answer instead of showing a zero', () => {
    expect(extractedTasksLabel(0)).toBe('sin tareas')
  })
})

describe('extractButtonLabel', () => {
  it('carries the number it is about to run', () => {
    expect(extractButtonLabel(1)).toBe('Extraer 1 nota')
    expect(extractButtonLabel(12)).toBe('Extraer 12 notas')
  })
})
