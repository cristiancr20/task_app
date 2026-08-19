/**
 * A write-behind queue: one debounced, ordered save per key.
 *
 * The task table persists itself as it is edited, and an edit is a keystroke —
 * so the write has to wait for the typing to stop (`delay`) rather than follow
 * every character. Two things beyond the timer make it safe:
 *
 * - **The key is captured with the value.** A save scheduled for one note is
 *   written under that note however long it takes to fire, so moving to another
 *   file mid-edit never lands the first note's rows on the second one.
 * - **Writes for a key are chained.** The whole state travels on every save, so
 *   the last one has to be the one that sticks; letting two overlap would leave
 *   whichever the server finished last on disk, which is not necessarily the
 *   newer one.
 *
 * Failures are reported to `onError` and dropped: a save that could not be made
 * must not take the queue down with it, because the state it was carrying is
 * still on screen and the next edit will try again.
 */

export type SaveQueue<T> = {
  /** Save `value` under `key` once nothing new has arrived for `delay` ms. */
  schedule(key: string, value: T): void
  /** Save now, replacing anything pending for `key` — for a change worth not losing. */
  saveNow(key: string, value: T): void
  /** Fire every pending save immediately. For teardown: the alternative is losing them. */
  flushAll(): void
}

export type SaveQueueOptions<T> = {
  /** How long a value waits for a newer one before being written. */
  delay: number
  save: (key: string, value: T) => Promise<unknown>
  onError?: (err: unknown, key: string) => void
}

export function createSaveQueue<T>({ delay, save, onError }: SaveQueueOptions<T>): SaveQueue<T> {
  /** Values waiting for their timer, by key. At most one per key: the newest. */
  const waiting = new Map<string, { value: T; timer: ReturnType<typeof setTimeout> }>()
  /** The tail of the write chain of each key, dropped once it is the tail no more. */
  const writing = new Map<string, Promise<void>>()

  function write(key: string, value: T): void {
    const previous = writing.get(key) ?? Promise.resolve()

    const settled: Promise<void> = previous
      .then(() => save(key, value))
      .then(
        () => undefined,
        (err: unknown) => {
          onError?.(err, key)
        },
      )
      .then(() => {
        // Only the last write of a key clears it; an earlier one finishing
        // would otherwise unchain the newer write queued behind it.
        if (writing.get(key) === settled) writing.delete(key)
      })

    writing.set(key, settled)
  }

  function take(key: string): void {
    const pending = waiting.get(key)
    if (!pending) return
    clearTimeout(pending.timer)
    waiting.delete(key)
  }

  return {
    schedule(key, value) {
      take(key)
      const timer = setTimeout(() => {
        waiting.delete(key)
        write(key, value)
      }, delay)
      waiting.set(key, { value, timer })
    },

    saveNow(key, value) {
      take(key)
      write(key, value)
    },

    flushAll() {
      for (const [key, pending] of [...waiting]) {
        take(key)
        write(key, pending.value)
      }
    },
  }
}
