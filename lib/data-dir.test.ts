import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

// `DATA_DIR` is `process.cwd() + '/.data'`, computed once when the module is
// evaluated, so the only way to point it at a temp folder is to stub `cwd` and
// then load the module fresh — hence `resetModules` plus a dynamic import.
async function loadDataDir(cwd: string) {
  vi.resetModules()
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  return import('@/lib/data-dir')
}

const created: string[] = []

/** A fresh, empty parent folder; `.data/` under it does not exist yet. */
function tempCwd(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-app-data-dir-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  vi.restoreAllMocks()
  let dir: string | undefined
  while ((dir = created.pop())) fs.rmSync(dir, { recursive: true, force: true })
})

// The mode bits mean nothing on Windows, where who may read a folder is an ACL
// question and `chmod` only moves the read-only flag.
const onPosix = process.platform !== 'win32'

describe('ensureDataDir', () => {
  it('creates the folder and returns its path', async () => {
    const cwd = tempCwd()
    const { DATA_DIR, ensureDataDir } = await loadDataDir(cwd)

    expect(ensureDataDir()).toBe(DATA_DIR)
    expect(DATA_DIR).toBe(path.join(cwd, '.data'))
    expect(fs.statSync(DATA_DIR).isDirectory()).toBe(true)
  })

  it.skipIf(!onPosix)('creates it owner-only — it holds the config with the API keys', async () => {
    const { DATA_DIR, ensureDataDir } = await loadDataDir(tempCwd())
    ensureDataDir()

    expect((fs.statSync(DATA_DIR).mode & 0o777).toString(8)).toBe('700')
  })

  it('is safe to call again once the folder exists', async () => {
    const { DATA_DIR, ensureDataDir } = await loadDataDir(tempCwd())
    ensureDataDir()
    fs.writeFileSync(path.join(DATA_DIR, 'config.json'), '{}')

    expect(() => ensureDataDir()).not.toThrow()
    expect(fs.readdirSync(DATA_DIR)).toEqual(['config.json'])
  })
})

describe('dataFile', () => {
  it('resolves inside the data folder, creating it on the way', async () => {
    const cwd = tempCwd()
    const { dataFile } = await loadDataDir(cwd)

    expect(dataFile('config.json')).toBe(path.join(cwd, '.data', 'config.json'))
    expect(fs.existsSync(path.join(cwd, '.data'))).toBe(true)
  })
})
