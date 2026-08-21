import { describe, expect, it } from 'vitest'

import {
  MAX_CONSECUTIVE_FAILURES,
  type QueueDeps,
  type QueueEvent,
  type QueueNote,
  runExtractionQueue,
} from '@/lib/extraction-queue'
import { emptyExtraction, type ExtractedTask, type ExtractionResult } from '@/lib/extractors/task'

function notes(...names: string[]): QueueNote[] {
  return names.map((name) => ({ relPath: name, title: name.replace('.md', '') }))
}

/** A result with `count` tasks in it — only their number ever matters here. */
function withTasks(count: number): ExtractionResult {
  const task: ExtractedTask = {
    title: 'Do the thing',
    description: '',
    priority: 'none',
    mentioned: null,
    dueDate: null,
    evidence: 'lo dijo alguien',
  }
  return { ...emptyExtraction(), tasks: Array.from({ length: count }, () => ({ ...task })) }
}

/** Drain the generator into a list, which is what every case asserts over. */
async function run(list: readonly QueueNote[], deps: QueueDeps): Promise<QueueEvent[]> {
  const events: QueueEvent[] = []
  for await (const event of runExtractionQueue(list, deps)) events.push(event)
  return events
}

/**
 * Extraction and storage that work unless a case says otherwise, wrapped so
 * that every run records what it *launched* and what it actually stored —
 * which is what «de una en una» and «lo ya extraído se conserva» are asserted
 * over.
 */
function fakeDeps(
  overrides: Partial<QueueDeps> = {},
): QueueDeps & { launched: string[]; stored: string[] } {
  const launched: string[] = []
  const stored: string[] = []
  const extract = overrides.extract ?? (async () => emptyExtraction())
  const store = overrides.store ?? (async () => {})

  return {
    launched,
    stored,
    cancelled: overrides.cancelled,
    extract: async (relPath) => {
      launched.push(relPath)
      return extract(relPath)
    },
    store: async (relPath, result) => {
      await store(relPath, result)
      stored.push(relPath)
    },
  }
}

/** Let everything that is not waiting on the gate finish. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A promise plus the handle that settles it: a note held mid-extraction. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('runExtractionQueue', () => {
  it('reports the total before doing anything', async () => {
    const events = await run(notes('a.md', 'b.md'), fakeDeps())
    expect(events[0]).toEqual({ type: 'start', total: 2 })
  })

  it('extracts every note and stores each result', async () => {
    const deps = fakeDeps()
    await run(notes('a.md', 'b.md', 'c.md'), deps)

    expect(deps.launched).toEqual(['a.md', 'b.md', 'c.md'])
    expect(deps.stored).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('announces each note before extracting it, 1-based and with its title', async () => {
    const events = await run(notes('a.md', 'b.md'), fakeDeps())

    expect(events.filter((event) => event.type === 'extracting')).toEqual([
      { type: 'extracting', relPath: 'a.md', index: 1, total: 2, title: 'a' },
      { type: 'extracting', relPath: 'b.md', index: 2, total: 2, title: 'b' },
    ])
  })

  it('reports how many tasks each note produced', async () => {
    const sizes: Record<string, number> = { 'a.md': 3, 'b.md': 0 }
    const events = await run(
      notes('a.md', 'b.md'),
      fakeDeps({ extract: async (relPath) => withTasks(sizes[relPath]) }),
    )

    expect(events.filter((event) => event.type === 'extracted')).toEqual([
      { type: 'extracted', relPath: 'a.md', tasks: 3 },
      { type: 'extracted', relPath: 'b.md', tasks: 0 },
    ])
  })

  it('ends with the tally of the whole run', async () => {
    const events = await run(
      notes('a.md', 'b.md'),
      fakeDeps({ extract: async () => withTasks(2) }),
    )

    expect(events.at(-1)).toEqual({ type: 'done', extracted: 2, failed: 0, tasks: 4 })
  })

  it('runs one note at a time and never two at once', async () => {
    let running = 0
    let mostAtOnce = 0

    await run(
      notes('a.md', 'b.md', 'c.md'),
      fakeDeps({
        extract: async () => {
          running += 1
          mostAtOnce = Math.max(mostAtOnce, running)
          await Promise.resolve()
          running -= 1
          return emptyExtraction()
        },
      }),
    )

    expect(mostAtOnce).toBe(1)
  })

  it('does not start the next note until the previous one is stored', async () => {
    const gate = deferred<void>()
    const deps = fakeDeps({ store: async () => gate.promise })
    const drained = run(notes('a.md', 'b.md'), deps)

    // A macrotask, so every microtask the run could make progress on has
    // already run: what is missing is the store, and only the store.
    await flush()
    expect(deps.launched).toEqual(['a.md'])

    gate.resolve()
    await drained
    expect(deps.launched).toEqual(['a.md', 'b.md'])
  })

  it('answers only start and done for an empty tanda', async () => {
    const events = await run([], fakeDeps())
    expect(events).toEqual([
      { type: 'start', total: 0 },
      { type: 'done', extracted: 0, failed: 0, tasks: 0 },
    ])
  })

  describe('a note that fails', () => {
    it('is reported with its own message and does not stop the queue', async () => {
      const deps = fakeDeps({
        extract: async (relPath) => {
          if (relPath === 'a.md') throw new Error('Ollama no responde en 127.0.0.1:11434.')
          return emptyExtraction()
        },
      })
      const events = await run(notes('a.md', 'b.md'), deps)

      expect(events).toContainEqual({
        type: 'failed',
        relPath: 'a.md',
        error: 'Ollama no responde en 127.0.0.1:11434.',
      })
      expect(deps.launched).toEqual(['a.md', 'b.md'])
      expect(events.at(-1)).toEqual({ type: 'done', extracted: 1, failed: 1, tasks: 0 })
    })

    it('counts as failed when it was the storing that failed', async () => {
      const events = await run(
        notes('a.md'),
        fakeDeps({ store: async () => Promise.reject(new Error('No se pudieron guardar las tareas.')) }),
      )

      expect(events).toContainEqual({
        type: 'failed',
        relPath: 'a.md',
        error: 'No se pudieron guardar las tareas.',
      })
      expect(events.at(-1)).toEqual({ type: 'done', extracted: 0, failed: 1, tasks: 0 })
    })

    it('does not count its tasks, even though the model returned some', async () => {
      const events = await run(
        notes('a.md', 'b.md'),
        fakeDeps({
          extract: async () => withTasks(4),
          store: async (relPath) => {
            if (relPath === 'a.md') throw new Error('No se pudieron guardar las tareas.')
          },
        }),
      )

      expect(events.at(-1)).toEqual({ type: 'done', extracted: 1, failed: 1, tasks: 4 })
    })

    it('says nothing useful only when the failure carried no message', async () => {
      const events = await run(notes('a.md'), fakeDeps({ extract: async () => Promise.reject('') }))

      expect(events).toContainEqual({
        type: 'failed',
        relPath: 'a.md',
        error: 'No se pudo extraer la nota.',
      })
    })
  })

  describe('several failures in a row', () => {
    it(`stops the queue after ${MAX_CONSECUTIVE_FAILURES}`, async () => {
      const deps = fakeDeps({ extract: async () => Promise.reject(new Error('502')) })
      const events = await run(notes('a.md', 'b.md', 'c.md', 'd.md', 'e.md'), deps)

      expect(deps.launched).toEqual(['a.md', 'b.md', 'c.md'])
      expect(events.filter((event) => event.type === 'stopped')).toEqual([
        { type: 'stopped', reason: 'failures', error: expect.stringContaining('seguidas') },
      ])
      expect(events.at(-1)).toEqual({ type: 'done', extracted: 0, failed: 3, tasks: 0 })
    })

    it('is only a run of failures when nothing succeeded in between', async () => {
      const deps = fakeDeps({
        extract: async (relPath) => {
          if (relPath === 'c.md') return emptyExtraction()
          throw new Error('502')
        },
      })
      const events = await run(notes('a.md', 'b.md', 'c.md', 'd.md', 'e.md'), deps)

      expect(deps.launched).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md'])
      expect(events.some((event) => event.type === 'stopped')).toBe(false)
      expect(events.at(-1)).toEqual({ type: 'done', extracted: 1, failed: 4, tasks: 0 })
    })

    it('reports the stop before the summary, never after it', async () => {
      const events = await run(
        notes('a.md', 'b.md', 'c.md'),
        fakeDeps({ extract: async () => Promise.reject(new Error('502')) }),
      )

      const types = events.map((event) => event.type)
      expect(types.indexOf('stopped')).toBe(types.indexOf('done') - 1)
    })
  })

  describe('cancelling', () => {
    it('does not launch what is still pending', async () => {
      let cancelled = false
      const deps = fakeDeps({
        cancelled: () => cancelled,
        extract: async (relPath) => {
          if (relPath === 'a.md') cancelled = true
          return emptyExtraction()
        },
      })
      const events = await run(notes('a.md', 'b.md', 'c.md'), deps)

      expect(deps.launched).toEqual(['a.md'])
      expect(events).toContainEqual({ type: 'stopped', reason: 'cancelled', error: null })
    })

    it('keeps what was already extracted, and says so in the summary', async () => {
      let cancelled = false
      const deps = fakeDeps({
        cancelled: () => cancelled,
        extract: async (relPath) => {
          if (relPath === 'a.md') cancelled = true
          return withTasks(3)
        },
      })
      const events = await run(notes('a.md', 'b.md'), deps)

      // The note in flight is stored: it already cost its minutes.
      expect(deps.stored).toEqual(['a.md'])
      expect(events.at(-1)).toEqual({ type: 'done', extracted: 1, failed: 0, tasks: 3 })
    })

    it('launches nothing at all when it was cancelled before the first note', async () => {
      const deps = fakeDeps({ cancelled: () => true })
      const events = await run(notes('a.md', 'b.md'), deps)

      expect(deps.launched).toEqual([])
      expect(events).toEqual([
        { type: 'start', total: 2 },
        { type: 'stopped', reason: 'cancelled', error: null },
        { type: 'done', extracted: 0, failed: 0, tasks: 0 },
      ])
    })
  })
})
