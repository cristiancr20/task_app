import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSaveQueue, type SaveQueue } from '@/lib/save-queue'

const DELAY = 500

type Call = { key: string; value: number }

/** A promise the test resolves by hand, to hold a save open. */
function deferred(): {
  promise: Promise<void>
  resolve: () => void
  reject: (err: unknown) => void
} {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A queue over a `save` that records what it was asked to write. */
function harness(save?: (key: string, value: number) => Promise<unknown>): {
  queue: SaveQueue<number>
  calls: Call[]
  errors: Array<{ err: unknown; key: string }>
} {
  const calls: Call[] = []
  const errors: Array<{ err: unknown; key: string }> = []

  const queue = createSaveQueue<number>({
    delay: DELAY,
    save: (key, value) => {
      calls.push({ key, value })
      return save ? save(key, value) : Promise.resolve()
    },
    onError: (err, key) => {
      errors.push({ err, key })
    },
  })

  return { queue, calls, errors }
}

/** Let every pending promise settle without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('schedule', () => {
  it('does not save before the delay is up', async () => {
    const { queue, calls } = harness()

    queue.schedule('nota.md', 1)
    await vi.advanceTimersByTimeAsync(DELAY - 1)

    expect(calls).toEqual([])
  })

  it('saves once the delay is up', async () => {
    const { queue, calls } = harness()

    queue.schedule('nota.md', 1)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([{ key: 'nota.md', value: 1 }])
  })

  // The point of the delay: a title typed one character at a time is one write.
  it('collapses a burst into a single save of the newest value', async () => {
    const { queue, calls } = harness()

    queue.schedule('nota.md', 1)
    await vi.advanceTimersByTimeAsync(100)
    queue.schedule('nota.md', 2)
    await vi.advanceTimersByTimeAsync(100)
    queue.schedule('nota.md', 3)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([{ key: 'nota.md', value: 3 }])
  })

  it('restarts the wait on every value, rather than firing at the first', async () => {
    const { queue, calls } = harness()

    queue.schedule('nota.md', 1)
    await vi.advanceTimersByTimeAsync(400)
    queue.schedule('nota.md', 2)
    await vi.advanceTimersByTimeAsync(400)

    expect(calls).toEqual([])
  })

  it('saves again after a save has already gone out', async () => {
    const { queue, calls } = harness()

    queue.schedule('nota.md', 1)
    await vi.advanceTimersByTimeAsync(DELAY)
    queue.schedule('nota.md', 2)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([
      { key: 'nota.md', value: 1 },
      { key: 'nota.md', value: 2 },
    ])
  })

  it('keeps one pending value per key', async () => {
    const { queue, calls } = harness()

    queue.schedule('una.md', 1)
    queue.schedule('otra.md', 2)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([
      { key: 'una.md', value: 1 },
      { key: 'otra.md', value: 2 },
    ])
  })

  it('does not let a newer key delay an older one', async () => {
    const { queue, calls } = harness()

    queue.schedule('una.md', 1)
    await vi.advanceTimersByTimeAsync(400)
    queue.schedule('otra.md', 2)
    await vi.advanceTimersByTimeAsync(100)

    expect(calls).toEqual([{ key: 'una.md', value: 1 }])
  })

  /**
   * The reason the key travels with the value: the note being edited when the
   * save was scheduled is the note it is written under, however long the timer
   * takes and whatever is on screen by then.
   */
  it('writes under the key it captured, not the last one scheduled', async () => {
    const { queue, calls } = harness()

    queue.schedule('la-que-edité.md', 7)
    // The user moves to another note before the first one's timer fires.
    await vi.advanceTimersByTimeAsync(400)
    queue.schedule('la-que-miro-ahora.md', 8)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([
      { key: 'la-que-edité.md', value: 7 },
      { key: 'la-que-miro-ahora.md', value: 8 },
    ])
  })
})

describe('saveNow', () => {
  it('saves without waiting for the delay', async () => {
    const { queue, calls } = harness()

    queue.saveNow('nota.md', 1)
    await settle()

    expect(calls).toEqual([{ key: 'nota.md', value: 1 }])
  })

  it('replaces what was pending for that key', async () => {
    const { queue, calls } = harness()

    queue.schedule('nota.md', 1)
    queue.saveNow('nota.md', 2)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([{ key: 'nota.md', value: 2 }])
  })

  it('leaves what is pending for other keys alone', async () => {
    const { queue, calls } = harness()

    queue.schedule('otra.md', 1)
    queue.saveNow('nota.md', 2)
    await settle()

    expect(calls).toEqual([{ key: 'nota.md', value: 2 }])

    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([
      { key: 'nota.md', value: 2 },
      { key: 'otra.md', value: 1 },
    ])
  })
})

describe('ordering', () => {
  /**
   * Every save carries the whole state, so the last one has to be the one left
   * on disk. Two overlapping writes would leave whichever the server happened
   * to finish last, which is not necessarily the newer one.
   */
  it('waits for a key’s write to finish before starting the next', async () => {
    const gate = deferred()
    let started = 0
    const { queue, calls } = harness(() => (++started === 1 ? gate.promise : Promise.resolve()))

    queue.saveNow('nota.md', 1)
    await settle()
    queue.saveNow('nota.md', 2)
    await settle()

    expect(calls).toEqual([{ key: 'nota.md', value: 1 }])

    gate.resolve()
    await settle()

    expect(calls).toEqual([
      { key: 'nota.md', value: 1 },
      { key: 'nota.md', value: 2 },
    ])
  })

  it('does not make one key wait for another', async () => {
    const gate = deferred()
    const { queue, calls } = harness((key) => (key === 'lenta.md' ? gate.promise : Promise.resolve()))

    queue.saveNow('lenta.md', 1)
    queue.saveNow('rápida.md', 2)
    await settle()

    expect(calls).toEqual([
      { key: 'lenta.md', value: 1 },
      { key: 'rápida.md', value: 2 },
    ])

    gate.resolve()
    await settle()
  })
})

describe('failures', () => {
  it('reports the failure with the key it belonged to', async () => {
    const failure = new Error('No se pudo guardar.')
    const { queue, errors } = harness(() => Promise.reject(failure))

    queue.schedule('nota.md', 1)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(errors).toEqual([{ err: failure, key: 'nota.md' }])
  })

  // A save that failed leaves the state on screen, so the next edit is the
  // retry — which only works if the failure did not stall the key's chain.
  it('saves the next value after one fails', async () => {
    let attempt = 0
    const { queue, calls, errors } = harness(() =>
      ++attempt === 1 ? Promise.reject(new Error('caída')) : Promise.resolve(),
    )

    queue.schedule('nota.md', 1)
    await vi.advanceTimersByTimeAsync(DELAY)
    queue.schedule('nota.md', 2)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toHaveLength(2)
    expect(errors).toHaveLength(1)
  })

  it('does not let one key’s failure stop another', async () => {
    const { queue, calls } = harness((key) =>
      key === 'rota.md' ? Promise.reject(new Error('caída')) : Promise.resolve(),
    )

    queue.schedule('rota.md', 1)
    queue.schedule('sana.md', 2)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([
      { key: 'rota.md', value: 1 },
      { key: 'sana.md', value: 2 },
    ])
  })

  it('swallows a rejection when there is nobody to report it to', async () => {
    const calls: Call[] = []
    const queue = createSaveQueue<number>({
      delay: DELAY,
      save: (key, value) => {
        calls.push({ key, value })
        return Promise.reject(new Error('caída'))
      },
    })

    queue.schedule('nota.md', 1)
    await vi.advanceTimersByTimeAsync(DELAY)
    queue.schedule('nota.md', 2)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toHaveLength(2)
  })
})

describe('flushAll', () => {
  it('writes everything pending without waiting', async () => {
    const { queue, calls } = harness()

    queue.schedule('una.md', 1)
    queue.schedule('otra.md', 2)
    queue.flushAll()
    await settle()

    expect(calls).toEqual([
      { key: 'una.md', value: 1 },
      { key: 'otra.md', value: 2 },
    ])
  })

  it('writes each key once, not once more when its timer would have fired', async () => {
    const { queue, calls } = harness()

    queue.schedule('nota.md', 1)
    queue.flushAll()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([{ key: 'nota.md', value: 1 }])
  })

  it('does nothing when nothing is pending', async () => {
    const { queue, calls } = harness()

    queue.flushAll()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([])
  })

  it('leaves the queue usable afterwards', async () => {
    const { queue, calls } = harness()

    queue.schedule('nota.md', 1)
    queue.flushAll()
    await settle()
    queue.schedule('nota.md', 2)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([
      { key: 'nota.md', value: 1 },
      { key: 'nota.md', value: 2 },
    ])
  })
})
