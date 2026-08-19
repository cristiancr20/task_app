import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  PathEscapesRootError,
  listFolder,
  normalizeRelPath,
  readTranscript,
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

describe('readTranscript', () => {
  // Fixtures are written by the test itself into a temp folder, so the suite
  // never depends on whatever notes happen to live on this machine.
  let base: string
  let root: string

  const write = (relPath: string, contents: string) => {
    const abs = path.join(root, relPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, contents)
  }

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'transcripts-read-'))
    root = path.join(base, 'root')
    fs.mkdirSync(root, { recursive: true })

    write(
      '2026-01-05 kickoff.md',
      [
        '---',
        'title: Kickoff del proyecto',
        'date: 2026-01-06',
        'attendees:',
        '  - Ana',
        '  - Beto',
        '  - Carla',
        '---',
        '# Kickoff',
        '',
        'Cuatro palabras mas aqui.',
        '',
      ].join('\n'),
    )

    write(
      'comma-attendees.md',
      ['---', 'title: Comas', 'attendees: Ana, Beto , Carla', '---', 'cuerpo', ''].join('\n'),
    )

    write(
      'malformed.md',
      ['---', 'title: [sin cerrar', 'date: 2026-02-02', '---', '# Cuerpo', ''].join('\n'),
    )

    write('scalar-frontmatter.md', ['---', 'solo un escalar', '---', '# Cuerpo', ''].join('\n'))

    write('sequence-frontmatter.md', ['---', '- Ana', '- Beto', '---', '# Cuerpo', ''].join('\n'))

    // No frontmatter at all: title and date have to come from the filename.
    write('2026-08-09 Weekly sync.md', ['# Weekly sync', '', 'Sin frontmatter.', ''].join('\n'))

    // `!!timestamp` is the one spelling the YAML core schema turns into a real
    // `Date` — a bare `2026-08-09` comes back as a string.
    write('yaml-date.md', ['---', 'date: !!timestamp 2026-03-04', '---', 'cuerpo', ''].join('\n'))

    write('iso-date.md', ['---', 'date: 2026-04-05T10:11:12Z', '---', 'cuerpo', ''].join('\n'))

    write(
      'bom.md',
      '\ufeff' + ['---', 'title: Con BOM', 'date: 2026-05-06', '---', 'cuerpo', ''].join('\n'),
    )
  })

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('reads title, date and a YAML list of attendees, and strips the block', () => {
    const { meta, body } = readTranscript(root, '2026-01-05 kickoff.md')

    expect(meta.hasFrontmatter).toBe(true)
    expect(meta.title).toBe('Kickoff del proyecto')
    // The frontmatter wins over the `2026-01-05` in the filename.
    expect(meta.date).toBe('2026-01-06')
    expect(meta.attendees).toEqual(['Ana', 'Beto', 'Carla'])
    expect(meta.relPath).toBe('2026-01-05 kickoff.md')
    expect(meta.fileName).toBe('2026-01-05 kickoff.md')

    expect(body).toBe('# Kickoff\n\nCuatro palabras mas aqui.\n')
    expect(body).not.toContain('---')
    expect(body).not.toContain('title:')
  })

  it('counts words and tokens over the body only, not the frontmatter', () => {
    const { meta } = readTranscript(root, '2026-01-05 kickoff.md')

    // '# Kickoff' + 'Cuatro palabras mas aqui.' = 6 whitespace-separated words.
    expect(meta.words).toBe(6)
    expect(meta.approxTokens).toBe(Math.ceil('# Kickoff\n\nCuatro palabras mas aqui.'.length / 4))
  })

  it('reads a single comma-separated line of attendees as the same list', () => {
    const listed = readTranscript(root, '2026-01-05 kickoff.md').meta.attendees
    const inline = readTranscript(root, 'comma-attendees.md').meta.attendees

    expect(inline).toEqual(['Ana', 'Beto', 'Carla'])
    expect(inline).toEqual(listed)
  })

  it('treats malformed YAML as body text instead of throwing', () => {
    const { meta, body } = readTranscript(root, 'malformed.md')

    expect(meta.hasFrontmatter).toBe(false)
    // Nothing was parsed, so the metadata falls back to the filename.
    expect(meta.title).toBe('malformed')
    expect(meta.date).toBe(null)
    expect(meta.attendees).toEqual([])
    // The unparsed block stays in the body rather than disappearing.
    expect(body).toContain('title: [sin cerrar')
    expect(body.startsWith('---')).toBe(true)
  })

  it('refuses a frontmatter that is a scalar or a sequence', () => {
    const scalar = readTranscript(root, 'scalar-frontmatter.md')
    const sequence = readTranscript(root, 'sequence-frontmatter.md')

    // Both parse as valid YAML; neither carries named fields.
    expect(scalar.meta.hasFrontmatter).toBe(false)
    expect(scalar.body).toContain('solo un escalar')

    expect(sequence.meta.hasFrontmatter).toBe(false)
    expect(sequence.meta.attendees).toEqual([])
    expect(sequence.body).toContain('- Ana')
  })

  it('falls back to the filename for title and date when there is no frontmatter', () => {
    const { meta, body } = readTranscript(root, '2026-08-09 Weekly sync.md')

    expect(meta.hasFrontmatter).toBe(false)
    expect(meta.title).toBe('Weekly sync')
    expect(meta.date).toBe('2026-08-09')
    expect(meta.attendees).toEqual([])
    expect(body).toBe('# Weekly sync\n\nSin frontmatter.\n')
  })

  it('normalizes a date the YAML parser turned into a Date object', () => {
    expect(readTranscript(root, 'yaml-date.md').meta.date).toBe('2026-03-04')
    // A string ISO timestamp keeps only the date part too.
    expect(readTranscript(root, 'iso-date.md').meta.date).toBe('2026-04-05')
  })

  it('detects the frontmatter behind a leading BOM', () => {
    const { meta, body } = readTranscript(root, 'bom.md')

    expect(meta.hasFrontmatter).toBe(true)
    expect(meta.title).toBe('Con BOM')
    expect(meta.date).toBe('2026-05-06')
    expect(body).toBe('cuerpo\n')
    expect(body.charCodeAt(0)).not.toBe(0xfeff)
  })
})

describe('listFolder', () => {
  let base: string
  let root: string
  /** `chmod 000` does nothing for root, so the unreadable case can't be shown. */
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

  const write = (relPath: string, contents: string) => {
    const abs = path.join(root, relPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, contents)
  }

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'transcripts-list-'))
    root = path.join(base, 'root')
    fs.mkdirSync(root, { recursive: true })

    // What must be listed, in deliberately wrong order on disk.
    write('notas/2026-03-01 beta.md', '# beta\n')
    write('notas/2026-05-02 later.md', '# later\n')
    write('notas/2026-03-01 alfa.md', '# alfa\n')
    write('notas/undated.md', '# undated\n')
    write('notas/also undated.md', '# also undated\n')
    // Frontmatter beats the filename for sorting purposes too.
    write('notas/zzz.md', ['---', 'title: Aaa con frontmatter', 'date: 2026-09-09', '---', 'x', ''].join('\n'))

    // What must be left out.
    write('notas/.oculto.md', '# oculto\n')
    write('notas/notas.txt', 'no es markdown\n')
    write('notas/README', 'tampoco\n')
    write('notas/node_modules/dep.md', '# dep\n')
    write('notas/sub/profundo.md', '# profundo\n')
    fs.mkdirSync(path.join(root, 'notas', '.git'), { recursive: true })

    write('rota/buena.md', '# buena\n')
    write('rota/otra.md', '# otra\n')
    write('rota/ilegible.md', '# ilegible\n')
    if (!isRoot) fs.chmodSync(path.join(root, 'rota', 'ilegible.md'), 0o000)
  })

  afterAll(() => {
    if (!isRoot) fs.chmodSync(path.join(root, 'rota', 'ilegible.md'), 0o600)
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('lists only .md files, skipping dotfiles and node_modules', () => {
    const { files, relPath } = listFolder(root, 'notas')

    expect(relPath).toBe('notas')
    expect(files.map((it) => it.fileName).sort()).toEqual([
      '2026-03-01 alfa.md',
      '2026-03-01 beta.md',
      '2026-05-02 later.md',
      'also undated.md',
      'undated.md',
      'zzz.md',
    ])
    expect(files.map((it) => it.fileName)).not.toContain('.oculto.md')
    expect(files.map((it) => it.fileName)).not.toContain('notas.txt')
    expect(files.map((it) => it.fileName)).not.toContain('README')
  })

  it('does not recurse: subfolders are named, their files are not listed', () => {
    const { folders, files } = listFolder(root, 'notas')

    // `node_modules` and `.git` are folders too, and neither is offered.
    expect(folders).toEqual([{ name: 'sub', relPath: 'notas/sub' }])
    expect(files.map((it) => it.fileName)).not.toContain('profundo.md')
    expect(files.map((it) => it.fileName)).not.toContain('dep.md')
    // The nested file is reachable, just one level down.
    expect(listFolder(root, 'notas/sub').files.map((it) => it.fileName)).toEqual([
      'profundo.md',
    ])
  })

  it('prefixes relPath with the folder that was listed', () => {
    const { files } = listFolder(root, 'notas')

    for (const file of files) {
      expect(file.relPath).toBe(`notas/${file.fileName}`)
    }
  })

  it('sorts by date descending, then by title, with undated files last', () => {
    const { files } = listFolder(root, 'notas')

    expect(files.map((it) => it.title)).toEqual([
      'Aaa con frontmatter', // 2026-09-09, from the frontmatter of zzz.md
      'later', //              2026-05-02
      'alfa', //               2026-03-01, ties with beta and wins on title
      'beta', //               2026-03-01
      'also undated', //       no date at all, so title order among themselves
      'undated',
    ])
    expect(files.slice(-2).every((it) => it.date === null)).toBe(true)
  })

  it.skipIf(isRoot)('keeps listing the rest of the folder when one file is unreadable', () => {
    // Guard against a vacuous pass: if the file were readable the listing would
    // simply contain it, and the try/catch would never run.
    expect(() => fs.readFileSync(path.join(root, 'rota', 'ilegible.md'), 'utf8')).toThrow()

    const { files } = listFolder(root, 'rota')

    expect(files.map((it) => it.fileName)).toEqual(['buena.md', 'otra.md'])
  })

  it('lists the root itself when given an empty path', () => {
    const { relPath, folders, files } = listFolder(root, '')

    expect(relPath).toBe('')
    expect(folders.map((it) => it.name)).toEqual(['notas', 'rota'])
    expect(files).toEqual([])
  })
})
