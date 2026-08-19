import fs from 'node:fs'
import path from 'node:path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DATA_DIR } from '@/lib/data-dir'
import { DEFAULT_OLLAMA_MODEL } from '@/lib/ollama'
import {
  addHistoryEntry,
  defaultConfig,
  getConfig,
  getHistory,
  getPushSummaries,
  updateConfig,
  type Config,
  type HistoryEntry,
  type HistoryIssue,
} from '@/lib/store'

// `DATA_DIR` is `process.cwd() + '/.data'`, resolved when the module loads, so
// pointing the store somewhere else means replacing the module itself. The
// factory runs once, before `lib/store` is imported, and the test file reads
// `DATA_DIR` back from the mock so both sides always agree on the folder.
vi.mock('@/lib/data-dir', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-app-store-'))

  return {
    DATA_DIR: dir,
    ensureDataDir: () => dir,
    dataFile: (fileName: string) => path.join(dir, fileName),
  }
})

const CONFIG_PATH = path.join(DATA_DIR, 'config.json')

/** Every test starts from an empty data folder — no file, not even a stale one. */
beforeEach(() => {
  for (const entry of fs.readdirSync(DATA_DIR)) {
    fs.rmSync(path.join(DATA_DIR, entry), { recursive: true, force: true })
  }
})

afterAll(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
})

/** Write `config.json` verbatim, so a test can plant something malformed. */
function writeRaw(contents: string): void {
  fs.writeFileSync(CONFIG_PATH, contents, 'utf8')
}

/** Write `config.json` as JSON, with fields of any shape the test needs. */
function writeConfig(value: unknown): void {
  writeRaw(JSON.stringify(value))
}

/** Read `config.json` back the way another process would: raw parse, no normalising. */
function readRaw(): unknown {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
}

function issue(overrides: Partial<HistoryIssue> = {}): HistoryIssue {
  return {
    id: 'issue-1',
    identifier: 'ENG-1',
    url: 'https://linear.app/acme/issue/ENG-1',
    title: 'Ship the thing',
    ...overrides,
  }
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return { pushedAt: '2026-01-01T00:00:00.000Z', issues: [issue()], ...overrides }
}

describe('defaultConfig', () => {
  it('starts empty with ollama as the provider', () => {
    expect(defaultConfig()).toEqual({
      recentFolders: [],
      contextRoot: null,
      provider: 'ollama',
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      claudeApiKey: '',
      linearApiKey: '',
      lastProjectId: null,
      history: {},
    })
  })

  it('hands out a fresh object each call, so callers cannot mutate the defaults', () => {
    const first = defaultConfig()
    first.recentFolders.push('/tmp/notes')
    expect(defaultConfig().recentFolders).toEqual([])
  })
})

describe('getConfig', () => {
  it('returns the defaults when the file does not exist', () => {
    expect(fs.existsSync(CONFIG_PATH)).toBe(false)
    expect(getConfig()).toEqual(defaultConfig())
  })

  it('returns the defaults instead of throwing when the JSON is invalid', () => {
    writeRaw('{"recentFolders": [')
    expect(getConfig()).toEqual(defaultConfig())
  })

  it('returns the defaults when the file is empty', () => {
    writeRaw('')
    expect(getConfig()).toEqual(defaultConfig())
  })

  it.each([
    ['an array', '[1, 2, 3]'],
    ['a string', '"nope"'],
    ['null', 'null'],
  ])('returns the defaults when the root of the file is %s', (_label, raw) => {
    writeRaw(raw)
    expect(getConfig()).toEqual(defaultConfig())
  })

  it('replaces fields of the wrong type with their default and keeps the valid ones', () => {
    writeConfig({
      recentFolders: '/tmp/notes',
      history: [{ pushedAt: '2026-01-01T00:00:00.000Z', issues: [] }],
      contextRoot: '/tmp/notes',
      ollamaModel: 'llama3.2',
      linearApiKey: 'lin_api_key',
      lastProjectId: 'project-7',
    })

    expect(getConfig()).toEqual({
      ...defaultConfig(),
      recentFolders: [],
      history: {},
      contextRoot: '/tmp/notes',
      ollamaModel: 'llama3.2',
      linearApiKey: 'lin_api_key',
      lastProjectId: 'project-7',
    })
  })

  it('drops the non-string members of recentFolders and keeps the rest', () => {
    writeConfig({ recentFolders: ['/tmp/a', 42, null, '/tmp/b'] })
    expect(getConfig().recentFolders).toEqual(['/tmp/a', '/tmp/b'])
  })

  it.each([
    ['contextRoot', 7],
    ['lastProjectId', { id: 'project-7' }],
  ])('nulls %s when it is not a string', (field, value) => {
    writeConfig({ [field]: value })
    expect(getConfig()[field as 'contextRoot' | 'lastProjectId']).toBeNull()
  })

  it.each([
    ['an unknown name', 'gemini'],
    ['an empty string', ''],
    ['a number', 3],
    ['absent', undefined],
  ])('falls back to ollama when provider is %s', (_label, provider) => {
    writeConfig({ provider })
    expect(getConfig().provider).toBe('ollama')
  })

  it('keeps claude, the one provider that is not the default', () => {
    writeConfig({ provider: 'claude' })
    expect(getConfig().provider).toBe('claude')
  })

  it.each([
    ['pushedAt is missing', { issues: [issue()] }],
    ['pushedAt is not a string', { pushedAt: 1767225600000, issues: [issue()] }],
    ['issues is missing', { pushedAt: '2026-01-01T00:00:00.000Z' }],
    ['issues is not an array', { pushedAt: '2026-01-01T00:00:00.000Z', issues: {} }],
    ['the entry is not an object', 'pushed'],
  ])('discards a history entry when %s', (_label, broken) => {
    const kept = entry({ pushedAt: '2026-02-02T00:00:00.000Z' })
    writeConfig({ history: { 'notes/a.md': [broken, kept] } })

    expect(getConfig().history['notes/a.md']).toEqual([kept])
  })

  it('drops the note entirely when every one of its entries is discarded', () => {
    writeConfig({ history: { 'notes/a.md': [{ issues: [issue()] }], 'notes/b.md': [entry()] } })

    expect(Object.keys(getConfig().history)).toEqual(['notes/b.md'])
  })

  it('keeps an entry whose issues array is empty — a push that created nothing still happened', () => {
    const empty = entry({ issues: [] })
    writeConfig({ history: { 'notes/a.md': [empty] } })

    expect(getConfig().history['notes/a.md']).toEqual([empty])
  })

  it('drops a malformed issue but keeps the entry around it', () => {
    writeConfig({
      history: {
        'notes/a.md': [{ pushedAt: '2026-01-01T00:00:00.000Z', issues: [{ id: 'x' }, issue()] }],
      },
    })

    expect(getConfig().history['notes/a.md']).toEqual([entry()])
  })

  it('ignores a history value that is not an array of entries', () => {
    writeConfig({ history: { 'notes/a.md': 'pushed', 'notes/b.md': [entry()] } })

    expect(Object.keys(getConfig().history)).toEqual(['notes/b.md'])
  })
})

describe('updateConfig', () => {
  it('merges the partial over what is stored and leaves the rest alone', () => {
    updateConfig({ contextRoot: '/tmp/notes', linearApiKey: 'lin_api_first' })
    const next = updateConfig({ linearApiKey: 'lin_api_second' })

    expect(next.linearApiKey).toBe('lin_api_second')
    expect(next.contextRoot).toBe('/tmp/notes')
  })

  it('persists the result, so the next read sees it', () => {
    updateConfig({ recentFolders: ['/tmp/a'], provider: 'claude' })

    expect(getConfig()).toEqual({
      ...defaultConfig(),
      recentFolders: ['/tmp/a'],
      provider: 'claude',
    })
  })

  it('writes a complete config even when it starts from no file at all', () => {
    updateConfig({ contextRoot: '/tmp/notes' })

    expect(readRaw()).toEqual({ ...defaultConfig(), contextRoot: '/tmp/notes' })
  })

  it('normalises the merged result, so a bad partial cannot poison the file', () => {
    const next = updateConfig({ provider: 'gemini' as Config['provider'] })

    expect(next.provider).toBe('ollama')
    expect((readRaw() as Config).provider).toBe('ollama')
  })

  it('rebuilds the file from defaults when the stored one was corrupt', () => {
    writeRaw('not json at all')
    updateConfig({ linearApiKey: 'lin_api_key' })

    expect(readRaw()).toEqual({ ...defaultConfig(), linearApiKey: 'lin_api_key' })
  })
})

describe('addHistoryEntry', () => {
  it('appends to the end, most recent last, keeping the previous entries', () => {
    const first = entry({ pushedAt: '2026-01-01T00:00:00.000Z' })
    const second = entry({ pushedAt: '2026-02-02T00:00:00.000Z', issues: [issue({ id: 'i2' })] })
    const third = entry({ pushedAt: '2026-03-03T00:00:00.000Z', issues: [issue({ id: 'i3' })] })

    addHistoryEntry('notes/a.md', first)
    addHistoryEntry('notes/a.md', second)
    addHistoryEntry('notes/a.md', third)

    expect(getHistory('notes/a.md')).toEqual([first, second, third])
  })

  it('keeps each note on its own key', () => {
    const a = entry({ pushedAt: '2026-01-01T00:00:00.000Z' })
    const b = entry({ pushedAt: '2026-02-02T00:00:00.000Z' })

    addHistoryEntry('notes/a.md', a)
    addHistoryEntry('notes/b.md', b)

    expect(getHistory('notes/a.md')).toEqual([a])
    expect(getHistory('notes/b.md')).toEqual([b])
  })

  it('persists across reads', () => {
    addHistoryEntry('notes/a.md', entry())

    expect(getConfig().history['notes/a.md']).toEqual([entry()])
  })

  it('leaves the existing entries untouched when the new one is malformed', () => {
    const good = entry()
    addHistoryEntry('notes/a.md', good)
    addHistoryEntry('notes/a.md', { issues: [issue()] } as unknown as HistoryEntry)

    expect(getHistory('notes/a.md')).toEqual([good])
  })

  it('does not touch the rest of the config', () => {
    updateConfig({ contextRoot: '/tmp/notes', provider: 'claude' })
    const next = addHistoryEntry('notes/a.md', entry())

    expect(next.contextRoot).toBe('/tmp/notes')
    expect(next.provider).toBe('claude')
  })
})

describe('getHistory', () => {
  it('is empty for a note that was never pushed', () => {
    expect(getHistory('notes/never.md')).toEqual([])
  })
})

describe('getPushSummaries', () => {
  it('is empty when nothing was ever pushed', () => {
    expect(getPushSummaries()).toEqual({})
  })

  it('counts the issues across every push and reports the last timestamp', () => {
    addHistoryEntry('notes/a.md', {
      pushedAt: '2026-01-01T00:00:00.000Z',
      issues: [issue({ id: 'i1' }), issue({ id: 'i2' })],
    })
    addHistoryEntry('notes/a.md', {
      pushedAt: '2026-02-02T00:00:00.000Z',
      issues: [issue({ id: 'i3' })],
    })

    expect(getPushSummaries()).toEqual({
      'notes/a.md': { issues: 3, pushes: 2, lastPushedAt: '2026-02-02T00:00:00.000Z' },
    })
  })

  it('omits a note whose pushes never created an issue', () => {
    addHistoryEntry('notes/empty.md', entry({ issues: [] }))
    addHistoryEntry('notes/a.md', entry())

    expect(Object.keys(getPushSummaries())).toEqual(['notes/a.md'])
  })

  it('summarises each note independently', () => {
    addHistoryEntry('notes/a.md', {
      pushedAt: '2026-01-01T00:00:00.000Z',
      issues: [issue({ id: 'i1' }), issue({ id: 'i2' })],
    })
    addHistoryEntry('notes/b.md', {
      pushedAt: '2026-03-03T00:00:00.000Z',
      issues: [issue({ id: 'i3' })],
    })

    expect(getPushSummaries()).toEqual({
      'notes/a.md': { issues: 2, pushes: 1, lastPushedAt: '2026-01-01T00:00:00.000Z' },
      'notes/b.md': { issues: 1, pushes: 1, lastPushedAt: '2026-03-03T00:00:00.000Z' },
    })
  })

  it('counts a push that created nothing when the note produced issues elsewhere', () => {
    addHistoryEntry('notes/a.md', entry({ pushedAt: '2026-01-01T00:00:00.000Z', issues: [] }))
    addHistoryEntry('notes/a.md', entry({ pushedAt: '2026-02-02T00:00:00.000Z' }))

    expect(getPushSummaries()['notes/a.md']).toEqual({
      issues: 1,
      pushes: 2,
      lastPushedAt: '2026-02-02T00:00:00.000Z',
    })
  })
})

// `chmod` is a no-op for the group/other bits on Windows, so the mode of a file
// there says nothing about who can read it — access is an ACL question instead.
const onPosix = process.platform !== 'win32'

/** The permission bits of `file`, e.g. `0o600`, with the file type stripped off. */
function permissions(file: string): number {
  return fs.statSync(file).mode & 0o777
}

describe('file permissions', () => {
  it.skipIf(!onPosix)('writes the config owner-only — it holds the API keys', () => {
    updateConfig({ linearApiKey: 'lin_api_key' })

    expect(permissions(CONFIG_PATH).toString(8)).toBe('600')
  })

  it.skipIf(!onPosix)('narrows a file an older version left world-readable', () => {
    writeConfig({ ...defaultConfig(), linearApiKey: 'lin_api_key' })
    fs.chmodSync(CONFIG_PATH, 0o644)

    updateConfig({ provider: 'claude' })

    expect(permissions(CONFIG_PATH).toString(8)).toBe('600')
  })

  it.skipIf(!onPosix)('never exposes the temp file, not even mid-write', () => {
    // The rename carries the temp file's mode over, so the only way the target
    // can end up at 0600 is if the temp file was already there.
    addHistoryEntry('notes/a.md', entry())

    expect(permissions(CONFIG_PATH).toString(8)).toBe('600')
  })
})

describe('the atomic write', () => {
  it('leaves no temp file behind in the data folder', () => {
    updateConfig({ contextRoot: '/tmp/notes' })
    addHistoryEntry('notes/a.md', entry())
    updateConfig({ provider: 'claude' })

    expect(fs.readdirSync(DATA_DIR)).toEqual(['config.json'])
  })

  it('writes the file as pretty JSON ending in a newline', () => {
    updateConfig({ contextRoot: '/tmp/notes' })
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')

    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toContain('\n  "contextRoot": "/tmp/notes"')
  })
})
