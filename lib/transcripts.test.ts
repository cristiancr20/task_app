import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  PathEscapesRootError,
  normalizeRelPath,
  resolveInsideRoot,
  titleFromFileName,
} from '@/lib/transcripts'

describe('titleFromFileName', () => {
  it('drops the .md extension', () => {
    expect(titleFromFileName('notes.md')).toBe('notes')
    expect(titleFromFileName('NOTES.MD')).toBe('NOTES')
  })

  it('drops a leading date and its separator', () => {
    expect(titleFromFileName('2026-08-09 Weekly sync.md')).toBe('Weekly sync')
    expect(titleFromFileName('2026-08-09_Weekly sync.md')).toBe('Weekly sync')
    expect(titleFromFileName('2026-08-09-Weekly sync.md')).toBe('Weekly sync')
  })

  it('turns underscores and dashes into single spaces', () => {
    expect(titleFromFileName('weekly-sync__notes.md')).toBe('weekly sync notes')
    expect(titleFromFileName('weekly   sync.md')).toBe('weekly sync')
  })

  it('keeps the stem when the date is all there is', () => {
    expect(titleFromFileName('2026-08-09.md')).toBe('2026 08 09')
  })
})

describe('normalizeRelPath', () => {
  it('treats the three spellings of the root as empty', () => {
    expect(normalizeRelPath('')).toBe('')
    expect(normalizeRelPath('.')).toBe('')
    expect(normalizeRelPath('/')).toBe('')
    expect(normalizeRelPath('   ')).toBe('')
  })

  it('reads an absolute-looking path as root-relative', () => {
    expect(normalizeRelPath('/sub/notes.md')).toBe('sub/notes.md')
    expect(normalizeRelPath('///sub/notes.md')).toBe('sub/notes.md')
  })

  it('normalizes backslashes to forward slashes', () => {
    expect(normalizeRelPath('sub\\notes.md')).toBe('sub/notes.md')
  })

  it('trims surrounding whitespace and trailing slashes', () => {
    expect(normalizeRelPath('  sub/nested  ')).toBe('sub/nested')
    expect(normalizeRelPath('sub/nested//')).toBe('sub/nested')
  })
})

describe('resolveInsideRoot', () => {
  // The root is a real temp folder: the guard calls `fs.realpathSync`, so the
  // symlink cases below need actual inodes, not a mocked filesystem. The root
  // sits inside a scratch folder so `..` targets a file that really exists —
  // an escape that resolves to nothing would be refused for the wrong reason.
  let base: string
  let root: string
  // `os.tmpdir()` is itself a symlink on macOS (`/var` -> `/private/var`), and
  // the guard resolves the root before comparing. Expectations use the real
  // path, never the one `mkdtempSync` handed back.
  let realBase: string
  let realRoot: string

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'transcripts-'))
    realBase = fs.realpathSync(base)
    root = path.join(base, 'root')
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
    realRoot = fs.realpathSync(root)

    fs.writeFileSync(path.join(root, 'notes.md'), '# notes\n')
    fs.writeFileSync(path.join(root, 'sub', 'nested.md'), '# nested\n')
    // Outside the root, but inside the scratch folder we clean up.
    fs.writeFileSync(path.join(base, 'fuera.md'), '# fuera\n')

    fs.symlinkSync(path.join(base, 'fuera.md'), path.join(root, 'escape.md'))
    fs.symlinkSync(path.join(root, 'sub', 'nested.md'), path.join(root, 'inside.md'))
  })

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('resolves a plain relative path to the absolute path inside the root', () => {
    expect(resolveInsideRoot(root, 'notes.md')).toBe(path.join(realRoot, 'notes.md'))
    expect(resolveInsideRoot(root, 'sub/nested.md')).toBe(
      path.join(realRoot, 'sub', 'nested.md'),
    )
  })

  it('resolves every spelling of the root to the root itself', () => {
    expect(resolveInsideRoot(root, '')).toBe(realRoot)
    expect(resolveInsideRoot(root, '.')).toBe(realRoot)
    expect(resolveInsideRoot(root, '/')).toBe(realRoot)
  })

  it('rejects a path that climbs out with ..', () => {
    // `../fuera.md` is a file that exists, so this is the real escape, not a
    // miss that would have failed anyway.
    expect(fs.existsSync(path.join(realBase, 'fuera.md'))).toBe(true)

    expect(() => resolveInsideRoot(root, '../fuera.md')).toThrow(PathEscapesRootError)
    expect(() => resolveInsideRoot(root, 'sub/../../fuera.md')).toThrow(PathEscapesRootError)
    expect(() => resolveInsideRoot(root, '../../fuera.md')).toThrow(PathEscapesRootError)
    expect(() => resolveInsideRoot(root, 'sub/../../../../../fuera.md')).toThrow(
      PathEscapesRootError,
    )
    expect(() => resolveInsideRoot(root, '..')).toThrow(PathEscapesRootError)
  })

  it('reads an absolute path as root-relative instead of following it', () => {
    const resolved = resolveInsideRoot(root, '/etc/passwd')

    expect(resolved).toBe(path.join(realRoot, 'etc', 'passwd'))
    expect(resolved).not.toBe('/etc/passwd')
    expect(fs.existsSync(resolved)).toBe(false)
  })

  it('rejects a symlink inside the root that points outside it', () => {
    // The lexical check passes — `escape.md` sits in the root. Only the
    // realpath check sees where it actually lands.
    expect(fs.realpathSync(path.join(root, 'escape.md'))).toBe(
      path.join(realBase, 'fuera.md'),
    )

    expect(() => resolveInsideRoot(root, 'escape.md')).toThrow(PathEscapesRootError)
  })

  it('accepts a symlink inside the root that points inside it', () => {
    expect(resolveInsideRoot(root, 'inside.md')).toBe(path.join(realRoot, 'inside.md'))
  })

  it('normalizes backslashes without letting them escape', () => {
    expect(resolveInsideRoot(root, 'sub\\nested.md')).toBe(
      path.join(realRoot, 'sub', 'nested.md'),
    )
    expect(() => resolveInsideRoot(root, '..\\fuera.md')).toThrow(PathEscapesRootError)
  })

  it('leaves a non-existent path to the caller instead of calling it an escape', () => {
    // `realpath` gives up silently on a missing path, so the guard falls back to
    // the lexical result and the ENOENT surfaces when the caller reads the file.
    expect(resolveInsideRoot(root, 'missing.md')).toBe(path.join(realRoot, 'missing.md'))
    expect(resolveInsideRoot(root, 'sub/deep/missing.md')).toBe(
      path.join(realRoot, 'sub', 'deep', 'missing.md'),
    )
  })
})
