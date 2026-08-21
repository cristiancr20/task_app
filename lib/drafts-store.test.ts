import fs from 'node:fs'
import path from 'node:path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DATA_DIR } from '@/lib/data-dir'
import {
  clearDrafts,
  emptyDrafts,
  getDrafts,
  getDraftedPaths,
  saveDrafts,
  type DraftRow,
  type DraftsState,
} from '@/lib/drafts-store'
import { emptyInsights } from '@/lib/extractors/task'

// Same trick as `store.test.ts`: `DATA_DIR` is `process.cwd() + '/.data'`,
// resolved when the module loads, so pointing the store somewhere else means
// replacing the module. The factory runs once, before `lib/drafts-store` is
// imported, and the test file reads `DATA_DIR` back from the mock so both sides
// always agree on the folder.
vi.mock('@/lib/data-dir', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-app-drafts-'))

  return {
    DATA_DIR: dir,
    ensureDataDir: () => dir,
    dataFile: (fileName: string) => path.join(dir, fileName),
  }
})

const DRAFTS_PATH = path.join(DATA_DIR, 'drafts.json')

/** Every test starts from an empty data folder — no file, not even a stale one. */
beforeEach(() => {
  for (const entry of fs.readdirSync(DATA_DIR)) {
    fs.rmSync(path.join(DATA_DIR, entry), { recursive: true, force: true })
  }
})

afterAll(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
})

/** Write `drafts.json` verbatim, so a test can plant something malformed. */
function writeRaw(contents: string): void {
  fs.writeFileSync(DRAFTS_PATH, contents, 'utf8')
}

/** Write the whole file as JSON, with fields of any shape the test needs. */
function writeFile(value: unknown): void {
  writeRaw(JSON.stringify(value))
}

/** Plant the stored state of one note, bypassing `saveDrafts`. */
function plant(relPath: string, stored: unknown): void {
  writeFile({ drafts: { [relPath]: stored } })
}

/** Read `drafts.json` back the way another process would: raw parse, no normalising. */
function readRaw(): unknown {
  return JSON.parse(fs.readFileSync(DRAFTS_PATH, 'utf8'))
}

function row(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: 'row-1',
    title: 'Send the Q3 budget to Marta',
    description: 'Marta needs it before the review on Friday.',
    priority: 'high',
    mentioned: 'Marta',
    dueDate: '2026-03-06',
    evidence: 'Te paso el presupuesto antes del viernes.',
    include: true,
    ...overrides,
  }
}

function state(overrides: Partial<DraftsState> = {}): DraftsState {
  return { rows: [row()], baseline: [row()], extracted: true, ...emptyInsights(), ...overrides }
}

/** A state whose fields are whatever the test needs, malformed included. */
function broken(value: unknown): DraftsState {
  return value as DraftsState
}

describe('emptyDrafts', () => {
  it('has no rows, no baseline and no extraction behind it', () => {
    expect(emptyDrafts()).toEqual({
      rows: [],
      baseline: [],
      extracted: false,
      decisions: [],
      risks: [],
      openQuestions: [],
    })
  })

  it('hands out a fresh object each call, so callers cannot mutate the empty state', () => {
    emptyDrafts().rows.push(row())
    expect(emptyDrafts().rows).toEqual([])
  })
})

describe('getDrafts', () => {
  it('is empty for a note that was never curated', () => {
    expect(fs.existsSync(DRAFTS_PATH)).toBe(false)
    expect(getDrafts('notes/never.md')).toEqual(emptyDrafts())
  })

  it('is empty instead of throwing when the JSON is invalid', () => {
    writeRaw('{"drafts": {')
    expect(getDrafts('notes/a.md')).toEqual(emptyDrafts())
  })

  it('is empty when the file is empty', () => {
    writeRaw('')
    expect(getDrafts('notes/a.md')).toEqual(emptyDrafts())
  })

  it.each([
    ['an array', '[1, 2, 3]'],
    ['a string', '"nope"'],
    ['null', 'null'],
  ])('is empty when the root of the file is %s', (_label, raw) => {
    writeRaw(raw)
    expect(getDrafts('notes/a.md')).toEqual(emptyDrafts())
  })

  it.each([
    ['missing', {}],
    ['an array', { drafts: [] }],
    ['a string', { drafts: 'notes/a.md' }],
  ])('is empty when the drafts map is %s', (_label, file) => {
    writeFile(file)
    expect(getDrafts('notes/a.md')).toEqual(emptyDrafts())
  })

  it('reads back exactly what was stored for the note', () => {
    plant('notes/a.md', state())
    expect(getDrafts('notes/a.md')).toEqual(state())
  })

  it('keeps a note whose drafts survive a sibling that does not', () => {
    writeFile({ drafts: { 'notes/broken.md': 'curated', 'notes/a.md': state() } })

    expect(getDrafts('notes/broken.md')).toEqual(emptyDrafts())
    expect(getDrafts('notes/a.md')).toEqual(state())
  })
})

describe('getDrafts, on rows that are malformed', () => {
  it('drops a row with no id — the key the table edits and removes rows by', () => {
    const kept = row({ id: 'row-2' })
    const { id: _id, ...withoutId } = row()
    plant('notes/a.md', { ...state(), rows: [withoutId, kept] })

    expect(getDrafts('notes/a.md').rows).toEqual([kept])
  })

  it.each([
    ['not a string', 7],
    ['empty', ''],
  ])('drops a row whose id is %s', (_label, id) => {
    plant('notes/a.md', { ...state(), rows: [row({ id: id as string })] })
    expect(getDrafts('notes/a.md').rows).toEqual([])
  })

  it.each([
    ['a string', 'Send the budget'],
    ['null', null],
    ['an array', ['Send the budget']],
  ])('drops a row that is %s rather than an object', (_label, value) => {
    plant('notes/a.md', { ...state(), rows: [value, row({ id: 'row-2' })] })
    expect(getDrafts('notes/a.md').rows).toEqual([row({ id: 'row-2' })])
  })

  it('empties the rows when they are not an array at all', () => {
    plant('notes/a.md', { ...state(), rows: 'row-1' })
    expect(getDrafts('notes/a.md').rows).toEqual([])
  })

  it.each([['title'], ['description'], ['evidence']])(
    'replaces %s with an empty string when it is not one',
    (field) => {
      plant('notes/a.md', { ...state(), rows: [{ ...row(), [field]: 42 }] })

      expect(getDrafts('notes/a.md').rows).toEqual([row({ [field]: '' })])
    },
  )

  it('keeps an empty title — that is a row the user was still typing, not a broken one', () => {
    plant('notes/a.md', { ...state(), rows: [row({ title: '' })] })
    expect(getDrafts('notes/a.md').rows).toEqual([row({ title: '' })])
  })

  it.each([
    ['an unknown level', 'blocker'],
    // Linear's own scale is numeric, so this is the shape that actually reaches
    // the file when something upstream forgets to translate it.
    ['a number', 1],
    ['null', null],
    ['absent', undefined],
  ])('falls back to the «none» priority when it is %s', (_label, priority) => {
    plant('notes/a.md', { ...state(), rows: [{ ...row(), priority }] })

    expect(getDrafts('notes/a.md').rows).toEqual([row({ priority: 'none' })])
  })

  it('keeps every priority of Linear’s scale', () => {
    plant('notes/a.md', {
      ...state(),
      rows: [row({ id: 'row-1', priority: 'urgent' }), row({ id: 'row-2', priority: 'low' })],
    })

    expect(getDrafts('notes/a.md').rows.map((it) => it.priority)).toEqual(['urgent', 'low'])
  })

  it('nulls «mentioned» when it is not a string — nobody was named', () => {
    plant('notes/a.md', { ...state(), rows: [{ ...row(), mentioned: { name: 'Marta' } }] })

    expect(getDrafts('notes/a.md').rows).toEqual([row({ mentioned: null })])
  })

  it.each([
    ['not a boolean', 'yes'],
    ['absent', undefined],
  ])('includes a row whose «include» flag is %s', (_label, include) => {
    plant('notes/a.md', { ...state(), rows: [{ ...row(), include }] })

    expect(getDrafts('notes/a.md').rows).toEqual([row({ include: true })])
  })

  it('keeps a row the user excluded — unchecking it is curation work', () => {
    plant('notes/a.md', { ...state(), rows: [row({ include: false })] })
    expect(getDrafts('notes/a.md').rows).toEqual([row({ include: false })])
  })

  it('sieves the baseline the same way as the rows', () => {
    plant('notes/a.md', { ...state(), baseline: [{ id: 'row-1' }, 'row-2'] })

    expect(getDrafts('notes/a.md').baseline).toEqual([
      { id: 'row-1', title: '', description: '', priority: 'none', mentioned: null, dueDate: null, evidence: '', include: true },
    ])
  })

  it.each([
    ['not a boolean', 'yes'],
    ['absent', undefined],
  ])('leaves «extracted» false when it is %s', (_label, extracted) => {
    plant('notes/a.md', { ...state(), extracted })
    expect(getDrafts('notes/a.md').extracted).toBe(false)
  })
})

/** One extracted decision, as the extractor's own normaliser leaves it. */
const DECISION = {
  text: 'Ship the beta in September',
  decidedBy: 'Ana',
  evidence: 'Ana: lo sacamos en septiembre.',
}

const RISK = {
  text: 'The vendor may be late',
  affects: 'the launch date',
  evidence: 'Marta: el proveedor va con retraso.',
}

const QUESTION = { text: 'Who signs the pricing?', evidence: '¿quién firma el precio?' }

// The three lists that never become issues are stored beside the rows they
// came out of, because they cost the same model call and are replaced by the
// same regeneration — see `lib/insights-markdown` for what is done with them.
describe('getDrafts, on the decisions, risks and open questions', () => {
  it('reads back the three lists a note was extracted with', () => {
    const stored = state({ decisions: [DECISION], risks: [RISK], openQuestions: [QUESTION] })
    plant('notes/a.md', stored)

    expect(getDrafts('notes/a.md')).toEqual(stored)
  })

  // Every note stored before these lists existed looks exactly like this, and
  // «ausente = vacía» is what keeps its rows readable.
  it('reads a note stored before the lists existed as three empty ones', () => {
    plant('notes/a.md', { rows: [row()], baseline: [row()], extracted: true })

    expect(getDrafts('notes/a.md')).toEqual(state())
  })

  it('empties a list that is not an array at all', () => {
    plant('notes/a.md', broken({ ...state(), risks: 'ninguno' }))

    expect(getDrafts('notes/a.md').risks).toEqual([])
  })

  // The same sieve the extraction goes through: an entry with no text says
  // nothing, so it is noise whether it came from a model or from disk.
  it('drops an entry with no text', () => {
    plant('notes/a.md', broken({ ...state(), decisions: [{ evidence: 'sin texto' }, DECISION] }))

    expect(getDrafts('notes/a.md').decisions).toEqual([DECISION])
  })

  // Null and the empty string are both «no consta»; a number is read as its
  // own text, exactly as the extractor reads a model that answered one.
  it('nulls a qualifier that says nothing', () => {
    plant(
      'notes/a.md',
      broken({
        ...state(),
        decisions: [{ ...DECISION, decidedBy: null }, { ...DECISION, decidedBy: '  ' }],
        risks: [{ ...RISK, affects: 2026 }],
      }),
    )

    const drafts = getDrafts('notes/a.md')
    expect(drafts.decisions.map((decision) => decision.decidedBy)).toEqual([null, null])
    expect(drafts.risks[0].affects).toBe('2026')
  })
})

describe('saveDrafts, on the decisions, risks and open questions', () => {
  it('persists the three lists, so a reload restores them', () => {
    const stored = state({ decisions: [DECISION], risks: [RISK], openQuestions: [QUESTION] })
    saveDrafts('notes/a.md', stored)

    expect(getDrafts('notes/a.md')).toEqual(stored)
  })

  // A meeting that settled things and committed to none of them: the table is
  // empty and the panel is full, and dropping the key would lose the lot.
  it('keeps a note whose only content is what the meeting decided', () => {
    const onlyDecisions = { ...emptyDrafts(), decisions: [DECISION] }
    saveDrafts('notes/a.md', onlyDecisions)

    expect(getDrafts('notes/a.md')).toEqual(onlyDecisions)
  })

  it('still drops a note with nothing in any of the six fields', () => {
    saveDrafts('notes/a.md', state())
    saveDrafts('notes/a.md', emptyDrafts())

    expect(readRaw()).toEqual({ drafts: {} })
  })
})

describe('saveDrafts', () => {
  it('persists the state, so the next read sees it', () => {
    saveDrafts('notes/a.md', state())
    expect(getDrafts('notes/a.md')).toEqual(state())
  })

  it('keys the file by the note, keeping each one on its own key', () => {
    const a = state({ rows: [row({ id: 'row-1', title: 'A' })] })
    const b = state({ rows: [row({ id: 'row-2', title: 'B' })] })

    saveDrafts('notes/a.md', a)
    saveDrafts('notes/b.md', b)

    expect(getDrafts('notes/a.md')).toEqual(a)
    expect(getDrafts('notes/b.md')).toEqual(b)
  })

  it('replaces the note’s own state rather than merging into it', () => {
    saveDrafts('notes/a.md', state())
    const curated = state({ rows: [row({ id: 'row-9', title: 'Typed by hand' })] })

    expect(saveDrafts('notes/a.md', curated)).toEqual(curated)
    expect(getDrafts('notes/a.md')).toEqual(curated)
  })

  it('stores the drafts under the path, next to the other notes', () => {
    saveDrafts('notes/a.md', state())
    expect(readRaw()).toEqual({ drafts: { 'notes/a.md': state() } })
  })

  it('never persists the transient state — a spinner or a dialog is not a draft', () => {
    saveDrafts(
      'notes/a.md',
      broken({ ...state(), generating: true, error: 'Ollama no responde', confirming: true }),
    )

    expect(readRaw()).toEqual({ drafts: { 'notes/a.md': state() } })
  })

  it('normalises what it is given, so a bad row cannot poison the file', () => {
    const saved = saveDrafts(
      'notes/a.md',
      broken({ rows: [row(), { title: 'no id' }], baseline: 'nope', extracted: 'yes' }),
    )

    expect(saved).toEqual({ rows: [row()], baseline: [], extracted: false, ...emptyInsights() })
    expect(readRaw()).toEqual({ drafts: { 'notes/a.md': saved } })
  })

  it('rebuilds the file from scratch when the stored one was corrupt', () => {
    writeRaw('not json at all')
    saveDrafts('notes/a.md', state())

    expect(readRaw()).toEqual({ drafts: { 'notes/a.md': state() } })
  })

  it('drops the note when there is nothing left to restore', () => {
    saveDrafts('notes/a.md', state())
    saveDrafts('notes/b.md', state())

    saveDrafts('notes/a.md', emptyDrafts())

    expect(readRaw()).toEqual({ drafts: { 'notes/b.md': state() } })
  })

  it('keeps a note with no rows once it has been extracted — the model found none', () => {
    const nothingFound = { rows: [], baseline: [], extracted: true, ...emptyInsights() }
    saveDrafts('notes/a.md', nothingFound)

    expect(getDrafts('notes/a.md')).toEqual(nothingFound)
  })
})

describe('clearDrafts', () => {
  it('forgets the note and leaves the others alone', () => {
    saveDrafts('notes/a.md', state())
    saveDrafts('notes/b.md', state())

    clearDrafts('notes/a.md')

    expect(getDrafts('notes/a.md')).toEqual(emptyDrafts())
    expect(getDrafts('notes/b.md')).toEqual(state())
  })

  it('is not an error for a note that had no drafts', () => {
    saveDrafts('notes/a.md', state())

    expect(() => clearDrafts('notes/never.md')).not.toThrow()
    expect(readRaw()).toEqual({ drafts: { 'notes/a.md': state() } })
  })

  it('does not create the file when there is nothing stored at all', () => {
    clearDrafts('notes/never.md')
    expect(fs.existsSync(DRAFTS_PATH)).toBe(false)
  })
})

describe('getDraftedPaths', () => {
  it('is empty when nothing has ever been curated', () => {
    expect(getDraftedPaths()).toEqual([])
  })

  it('names every note with something stored', () => {
    saveDrafts('notes/a.md', state())
    saveDrafts('notes/b.md', state())

    expect(getDraftedPaths().sort()).toEqual(['notes/a.md', 'notes/b.md'])
  })

  it('stops naming a note whose drafts were cleared', () => {
    saveDrafts('notes/a.md', state())
    clearDrafts('notes/a.md')

    expect(getDraftedPaths()).toEqual([])
  })

  it('does not name a note whose stored state is empty', () => {
    saveDrafts('notes/a.md', state())
    saveDrafts('notes/a.md', emptyDrafts())

    expect(getDraftedPaths()).toEqual([])
  })

  it('names a note that only carries what the extraction found besides tasks', () => {
    saveDrafts(
      'notes/a.md',
      state({ rows: [], baseline: [], extracted: false, decisions: [DECISION] }),
    )

    expect(getDraftedPaths()).toEqual(['notes/a.md'])
  })

  it('does not name a note whose stored state is unreadable', () => {
    plant('notes/rota.md', 'esto no es un estado')

    expect(getDraftedPaths()).toEqual([])
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
  it.skipIf(!onPosix)('writes the drafts owner-only, like the config', () => {
    saveDrafts('notes/a.md', state())

    expect(permissions(DRAFTS_PATH).toString(8)).toBe('600')
  })

  it.skipIf(!onPosix)('narrows a file an older version left world-readable', () => {
    saveDrafts('notes/a.md', state())
    fs.chmodSync(DRAFTS_PATH, 0o644)

    clearDrafts('notes/a.md')

    expect(permissions(DRAFTS_PATH).toString(8)).toBe('600')
  })
})

describe('the atomic write', () => {
  it('leaves no temp file behind in the data folder', () => {
    saveDrafts('notes/a.md', state())
    saveDrafts('notes/b.md', state())
    clearDrafts('notes/a.md')

    expect(fs.readdirSync(DATA_DIR)).toEqual(['drafts.json'])
  })

  it('writes the file as pretty JSON ending in a newline', () => {
    saveDrafts('notes/a.md', state())
    const raw = fs.readFileSync(DRAFTS_PATH, 'utf8')

    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toContain('\n  "drafts": {')
  })
})
