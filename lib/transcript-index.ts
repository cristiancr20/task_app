/**
 * The recursive walk of the context root, kept in server memory.
 *
 * `walkTranscripts` reads and parses every `.md` under the root, so the inbox
 * and the search would each pay for a full disk scan on every request. This
 * module makes that scan happen once and be shared: one cached walk per root,
 * refreshed on a timer, rebuilt on demand, and never run twice at the same
 * time.
 *
 * What is cached is only what the walk returns — metadata, one small record per
 * note. The bodies are deliberately not here: they are what makes a note big,
 * they are read one at a time by whoever needs them, and holding them would
 * turn a bounded index into memory that grows with the size of the notes.
 */

import { walkTranscripts, type TranscriptWalk } from './transcripts'

/**
 * How long a walk is served before the disk is read again.
 *
 * The index answers «what is in the folder», and the folder changes when the
 * user drops a new transcript into it — from outside the app, so nothing tells
 * us it happened. Half a minute is short enough that a note written during a
 * meeting shows up on its own, and long enough that the burst of requests one
 * screen makes (inbox, then a search, then another) costs a single scan. The
 * reload button exists for the user who does not want to wait for it.
 */
export const TRANSCRIPT_INDEX_TTL_MS = 30_000

/** A cached walk, plus what the cache needs to decide whether it still counts. */
export type TranscriptIndexSnapshot = TranscriptWalk & {
  /** The context root this walk covers; a different one invalidates it. */
  root: string
  /** When the walk finished, on `now`'s clock. The TTL is measured from here. */
  builtAt: number
}

export type TranscriptIndexOptions = {
  /** Overridable so the tests can count walks and hold one open. */
  walk?: (root: string) => TranscriptWalk | Promise<TranscriptWalk>
  /** Overridable so the tests can move time without waiting for it. */
  now?: () => number
  /** Defaults to `TRANSCRIPT_INDEX_TTL_MS`. */
  ttlMs?: number
}

export type TranscriptIndex = {
  /**
   * The walk of `root`, from cache when it is still current and from disk when
   * it is not. The returned snapshot is the cached instance and is shared with
   * every other caller: read it, never mutate it.
   */
  get(root: string): Promise<TranscriptIndexSnapshot>
  /** Walk `root` again whatever the cache holds. This is the reload button. */
  refresh(root: string): Promise<TranscriptIndexSnapshot>
  /** Drop what is cached, so the next `get` rebuilds. */
  invalidate(): void
}

export function createTranscriptIndex(options: TranscriptIndexOptions = {}): TranscriptIndex {
  const walk = options.walk ?? walkTranscripts
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? TRANSCRIPT_INDEX_TTL_MS

  let snapshot: TranscriptIndexSnapshot | null = null
  /**
   * The walk currently running, if any. A second caller arriving while it is in
   * flight awaits this instead of starting its own — which is the whole reason
   * `get` is asynchronous over a synchronous walk.
   */
  let pending: { root: string; promise: Promise<TranscriptIndexSnapshot> } | null = null

  function isFresh(root: string): boolean {
    if (!snapshot || snapshot.root !== root) return false
    const age = now() - snapshot.builtAt
    // A clock that moved backwards reads as expired rather than as freshly
    // built, so a corrected system time cannot freeze the index until it
    // catches up.
    return age >= 0 && age < ttlMs
  }

  function build(root: string): Promise<TranscriptIndexSnapshot> {
    const promise = (async () => {
      const walked = await walk(root)
      return { ...walked, root, builtAt: now() }
    })()

    const started = { root, promise }
    pending = started

    return promise.then(
      (built) => {
        // Only the walk that is still the current one may publish: a refresh
        // started after this one is the newer read of the disk, and its result
        // must not be overwritten by an older walk finishing late.
        if (pending === started) {
          snapshot = built
          pending = null
        }
        return built
      },
      (err: unknown) => {
        // A failed walk leaves no snapshot behind and unblocks the next caller,
        // which will try the disk again rather than inherit the failure.
        if (pending === started) pending = null
        throw err
      },
    )
  }

  return {
    get(root) {
      if (isFresh(root)) return Promise.resolve(snapshot!)
      // A walk of the same root already running is the walk this call wants.
      // One of another root is not: the configured folder changed under it.
      if (pending && pending.root === root) return pending.promise
      return build(root)
    },

    refresh(root) {
      // Never joins a walk in flight: that one may have started before whatever
      // the user pressed reload to see.
      return build(root)
    },

    invalidate() {
      snapshot = null
      pending = null
    },
  }
}

/**
 * The index the server actually uses. Module state, so every request handler in
 * the process shares one walk; it is rebuilt from disk when the process
 * restarts, which is the correct answer for a cache of the filesystem.
 */
const sharedIndex = createTranscriptIndex()

/** The current walk of `root`, from the shared index. */
export function getTranscriptIndex(root: string): Promise<TranscriptIndexSnapshot> {
  return sharedIndex.get(root)
}

/** Force the shared index to walk `root` again — what the reload button calls. */
export function refreshTranscriptIndex(root: string): Promise<TranscriptIndexSnapshot> {
  return sharedIndex.refresh(root)
}

/** Drop the shared index, for a caller that knows the root just changed. */
export function invalidateTranscriptIndex(): void {
  sharedIndex.invalidate()
}
