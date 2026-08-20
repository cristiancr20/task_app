import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createTranscriptIndex,
  TRANSCRIPT_INDEX_TTL_MS,
  type TranscriptIndexOptions,
} from '@/lib/transcript-index'
import { type TranscriptMeta, type TranscriptWalk } from '@/lib/transcripts'

/** A walk carrying one recognisable file, so a result can be traced to its call. */
function walkOf(marker: string): TranscriptWalk {
  const file: TranscriptMeta = {
    relPath: `${marker}.md`,
    fileName: `${marker}.md`,
    title: marker,
    date: '2026-08-19',
    attendees: [],
    words: 1,
    approxTokens: 1,
    hasFrontmatter: false,
  }
  return { files: [file], truncated: false, depthLimitReached: false, fileLimitReached: false }
}

/** The single file's title of a snapshot, which is the marker it was built with. */
function markerOf(snapshot: { files: TranscriptMeta[] }): string {
  return snapshot.files[0].title
}

/** A promise the test resolves by hand, to hold a walk open. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/**
 * An index over a walk that records the roots it was asked for and, by default,
 * answers with a marker naming the call number — so «did this come from the
 * cache or from a second walk?» is a string comparison.
 */
function harness(
  options: Omit<TranscriptIndexOptions, 'now' | 'walk'> & {
    walk?: (root: string, call: number) => TranscriptWalk | Promise<TranscriptWalk>
  } = {},
) {
  const roots: string[] = []
  let clock = 1_000

  const index = createTranscriptIndex({
    ...options,
    now: () => clock,
    walk: (root) => {
      roots.push(root)
      const call = roots.length
      return options.walk ? options.walk(root, call) : walkOf(`walk-${call}`)
    },
  })

  return {
    index,
    roots,
    /** How many walks have been started. */
    get calls() {
      return roots.length
    },
    advance(ms: number) {
      clock += ms
    },
    set(ms: number) {
      clock = ms
    },
  }
}

describe('get', () => {
  it('walks the root the first time it is asked', async () => {
    const { index, roots } = harness()

    const snapshot = await index.get('/root')

    expect(roots).toEqual(['/root'])
    expect(snapshot.root).toBe('/root')
    expect(snapshot.builtAt).toBe(1_000)
    expect(markerOf(snapshot)).toBe('walk-1')
  })

  it('carries the walk result through untouched', async () => {
    const { index } = harness({
      walk: () => ({
        files: [],
        truncated: true,
        depthLimitReached: true,
        fileLimitReached: false,
      }),
    })

    const snapshot = await index.get('/root')

    expect(snapshot.truncated).toBe(true)
    expect(snapshot.depthLimitReached).toBe(true)
    expect(snapshot.fileLimitReached).toBe(false)
  })

  it('serves the cached walk inside the window', async () => {
    const h = harness()

    const first = await h.index.get('/root')
    h.advance(TRANSCRIPT_INDEX_TTL_MS - 1)
    const second = await h.index.get('/root')

    expect(h.calls).toBe(1)
    expect(second).toBe(first)
  })

  it('walks again once the window is over', async () => {
    const h = harness()

    await h.index.get('/root')
    h.advance(TRANSCRIPT_INDEX_TTL_MS)
    const second = await h.index.get('/root')

    expect(h.calls).toBe(2)
    expect(markerOf(second)).toBe('walk-2')
    expect(second.builtAt).toBe(1_000 + TRANSCRIPT_INDEX_TTL_MS)
  })

  it('honours a ttl given to the factory', async () => {
    const h = harness({ ttlMs: 10 })

    await h.index.get('/root')
    h.advance(9)
    await h.index.get('/root')
    expect(h.calls).toBe(1)

    h.advance(1)
    await h.index.get('/root')
    expect(h.calls).toBe(2)
  })

  it('treats a clock that moved backwards as expired', async () => {
    const h = harness()

    await h.index.get('/root')
    h.set(500)
    await h.index.get('/root')

    expect(h.calls).toBe(2)
  })
})

describe('root changes', () => {
  it('walks again when the configured root changed', async () => {
    const h = harness()

    await h.index.get('/first')
    const second = await h.index.get('/second')

    expect(h.roots).toEqual(['/first', '/second'])
    expect(second.root).toBe('/second')
    expect(markerOf(second)).toBe('walk-2')
  })

  it('does not keep the old root cached alongside the new one', async () => {
    const h = harness()

    await h.index.get('/first')
    await h.index.get('/second')
    const back = await h.index.get('/first')

    expect(h.calls).toBe(3)
    expect(markerOf(back)).toBe('walk-3')
  })

  it('drops everything on invalidate', async () => {
    const h = harness()

    await h.index.get('/root')
    h.index.invalidate()
    await h.index.get('/root')

    expect(h.calls).toBe(2)
  })
})

describe('refresh', () => {
  it('walks again even with a fresh cache', async () => {
    const h = harness()

    await h.index.get('/root')
    const refreshed = await h.index.refresh('/root')

    expect(h.calls).toBe(2)
    expect(markerOf(refreshed)).toBe('walk-2')
  })

  it('leaves its result as the cached one', async () => {
    const h = harness()

    await h.index.get('/root')
    await h.index.refresh('/root')
    const after = await h.index.get('/root')

    expect(h.calls).toBe(2)
    expect(markerOf(after)).toBe('walk-2')
  })
})

describe('concurrency', () => {
  it('walks once for two callers arriving cold', async () => {
    const held = deferred<TranscriptWalk>()
    const h = harness({ walk: () => held.promise })

    const first = h.index.get('/root')
    const second = h.index.get('/root')
    expect(h.calls).toBe(1)

    held.resolve(walkOf('shared'))

    expect(markerOf(await first)).toBe('shared')
    expect(await second).toBe(await first)
    expect(h.calls).toBe(1)
  })

  it('does not join a walk of a different root', async () => {
    const h = harness({ walk: (_root, call) => Promise.resolve(walkOf(`walk-${call}`)) })

    const first = h.index.get('/first')
    const second = h.index.get('/second')

    expect(markerOf(await first)).toBe('walk-1')
    expect(markerOf(await second)).toBe('walk-2')
    expect(h.roots).toEqual(['/first', '/second'])
  })

  it('keeps the newer walk when an older one finishes last', async () => {
    const slow = deferred<TranscriptWalk>()
    const quick = deferred<TranscriptWalk>()
    const h = harness({ walk: (_root, call) => (call === 1 ? slow.promise : quick.promise) })

    const stale = h.index.get('/root')
    const forced = h.index.refresh('/root')
    expect(h.calls).toBe(2)

    quick.resolve(walkOf('newer'))
    await forced
    slow.resolve(walkOf('older'))
    await stale

    const after = await h.index.get('/root')
    expect(markerOf(after)).toBe('newer')
    expect(h.calls).toBe(2)
  })

  it('caches nothing when the walk fails, and tries again next time', async () => {
    let attempts = 0
    const h = harness({
      walk: (_root, call) => {
        attempts += 1
        if (call === 1) return Promise.reject(new Error('EACCES'))
        return walkOf(`walk-${call}`)
      },
    })

    await expect(h.index.get('/root')).rejects.toThrow('EACCES')

    const second = await h.index.get('/root')
    expect(attempts).toBe(2)
    expect(markerOf(second)).toBe('walk-2')
  })
})

describe('over the real filesystem', () => {
  let root: string
  let clock = 0

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-index-'))
    fs.writeFileSync(path.join(root, '2026-08-19 Kickoff.md'), '---\ntitle: Kickoff\n---\n\nHola\n')
  })

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  /** The real walk, over the temp tree, with a clock the test moves. */
  function index() {
    clock = 1_000
    return createTranscriptIndex({ now: () => clock })
  }

  it('caches metadata and never a transcript body', async () => {
    const snapshot = await index().get(root)

    expect(snapshot.files).toHaveLength(1)
    expect(snapshot.files[0].title).toBe('Kickoff')
    expect(Object.keys(snapshot.files[0]).sort()).toEqual([
      'approxTokens',
      'attendees',
      'date',
      'fileName',
      'hasFrontmatter',
      'relPath',
      'title',
      'words',
    ])
  })

  it('sees a note written after the walk once the window is over', async () => {
    const idx = index()
    const before = await idx.get(root)
    expect(before.files).toHaveLength(1)

    fs.writeFileSync(path.join(root, '2026-08-20 Retro.md'), '# Retro\n')

    expect((await idx.get(root)).files).toHaveLength(1)

    clock += TRANSCRIPT_INDEX_TTL_MS
    expect((await idx.get(root)).files).toHaveLength(2)
  })

  it('sees it straight away when the rebuild is forced', async () => {
    const idx = index()
    await idx.get(root)

    fs.writeFileSync(path.join(root, '2026-08-21 Demo.md'), '# Demo\n')

    expect((await idx.refresh(root)).files.map((it) => it.title)).toContain('Demo')
  })
})
