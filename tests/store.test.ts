import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
const { Store, withDefaults, STORE_VERSION } = await import('../src/main/store')
const { account, removeTempDirs, tempFile } = await import('./main-helpers')

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
afterAll(removeTempDirs)

describe('loading', () => {
  it('starts empty without a file, and writes nothing until something changes', () => {
    const file = tempFile()
    const store = new Store(file)
    expect(store.accounts).toEqual([])
    expect(store.problem).toBeNull()
    store.flush()
    expect(existsSync(file)).toBe(false)
    store.upsert(account('a'))
    store.flush()
    expect(read(file)).toMatchObject({ version: STORE_VERSION, accounts: [{ id: 'a' }] })
  })

  it('brings a v1 file up to date and drops rows it can’t use', () => {
    const file = tempFile()
    writeFileSync(
      file,
      JSON.stringify({
        accounts: [{ id: 'a', email: 'a@example.com', partition: 'p-a' }, { email: 'x@example.com', partition: 'p-x' }, { id: 'y', email: 'y@example.com' }, null],
        view: { line1: 'hca' },
        tags: [{ id: 't', name: 'T', color: 'nope' }, { name: 'no id' }]
      })
    )
    const store = new Store(file)
    expect(store.accounts.map((a) => a.id)).toEqual(['a'])
    expect(store.accounts[0]).toMatchObject({ status: 'signed-out', pinned: false, tagIds: [], pending: null, attemptPath: null, slack: { linked: null, session: false } })
    expect(store.view.line1).toBe('best')
    expect(store.tags).toEqual([{ id: 't', name: 'T', color: 'gray' }])
    expect(store.problem).toBeNull()
  })

  it('keeps a v3 file’s own first line', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ version: 3, accounts: [], view: { line1: 'hca' } }))
    expect(new Store(file).view.line1).toBe('hca')
  })

  it('fills in missing view settings', () => {
    const view = withDefaults({ filter: { tags: ['a', 3 as unknown as string], tagMode: 'bogus' as 'any', status: ['signed-in', 'nope' as 'adding'] } })
    expect(view).toMatchObject({ ...DEFAULT_VIEW, filter: { tags: ['a'], tagMode: 'any', status: ['signed-in'] } })
    expect(withDefaults({}).filter.tags).toEqual([])
  })

  it('keeps only the named view settings, and replaces odd values', () => {
    const view = withDefaults({ sortBy: 'random', line2Tpl: 5, collapsed: { 'tpl:A': true, 'tpl:B': 'yes' }, secret: 'x' } as unknown as Partial<typeof DEFAULT_VIEW>)
    expect(view).toEqual({ ...DEFAULT_VIEW, collapsed: { 'tpl:A': true } })
  })
})

describe('an unreadable file', () => {
  it('is moved aside, and HAM starts empty and says so', () => {
    const file = tempFile()
    writeFileSync(file, '{"accounts": [')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = new Store(file)
    expect(store.accounts).toEqual([])
    const p = store.problem
    expect(p).toMatchObject({ kind: 'corrupt', restored: false })
    const backup = p?.kind === 'corrupt' ? p.backup : ''
    expect(backup).toMatch(/accounts\.json\.corrupt-/)
    expect(readFileSync(backup, 'utf8')).toBe('{"accounts": [')
    // A new write can't touch the backup.
    store.upsert(account('new'))
    store.flush()
    expect(readFileSync(backup, 'utf8')).toBe('{"accounts": [')
    expect(read(file).accounts.map((a: { id: string }) => a.id)).toEqual(['new'])
  })

  it('treats JSON without an accounts list as unreadable', () => {
    const file = tempFile()
    writeFileSync(file, 'null')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(new Store(file).problem).toMatchObject({ kind: 'corrupt' })
  })

  it('is restored from the last write’s temp file when that’s good', () => {
    const file = tempFile()
    writeFileSync(file, 'garbage')
    writeFileSync(`${file}.tmp`, JSON.stringify({ version: 3, accounts: [account('a')] }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = new Store(file)
    expect(store.accounts.map((a) => a.id)).toEqual(['a'])
    expect(store.problem).toMatchObject({ kind: 'corrupt', restored: true })
    store.flush()
    expect(read(file).accounts[0].id).toBe('a')
  })

  it('is left alone when it can’t be read at all, and nothing is written this session', () => {
    const file = tempFile()
    const text = JSON.stringify({ version: 3, accounts: [account('a')] })
    writeFileSync(file, text)
    chmodSync(file, 0o000)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const store = new Store(file)
      expect(store.problem).toEqual({ kind: 'read-only', reason: 'unreadable' })
      store.upsert(account('b'))
      store.flush()
    } finally {
      chmodSync(file, 0o600)
    }
    expect(readFileSync(file, 'utf8')).toBe(text)
    expect(readdirSync(dirname(file)).filter((f) => f.includes('corrupt'))).toEqual([])
  })

  it('a missing file with a good temp file uses the temp file', () => {
    const file = tempFile()
    writeFileSync(`${file}.tmp`, JSON.stringify({ version: 3, accounts: [account('a')] }))
    const store = new Store(file)
    expect(store.accounts.map((a) => a.id)).toEqual(['a'])
    expect(store.problem).toBeNull()
  })
})

describe('a file from a newer HAM', () => {
  it('is read but never written over', () => {
    const file = tempFile()
    const text = JSON.stringify({ version: STORE_VERSION + 1, accounts: [account('a')], futureField: true })
    writeFileSync(file, text)
    const store = new Store(file)
    expect(store.accounts.map((a) => a.id)).toEqual(['a'])
    expect(store.problem).toEqual({ kind: 'read-only', reason: 'newer' })
    store.upsert(account('b'))
    store.theme = 'dark'
    store.flush()
    expect(readFileSync(file, 'utf8')).toBe(text)
  })

  it('is read-only even when it has no accounts list', () => {
    const file = tempFile()
    const text = JSON.stringify({ version: STORE_VERSION + 1, profiles: [] })
    writeFileSync(file, text)
    const store = new Store(file)
    expect(store.problem).toEqual({ kind: 'read-only', reason: 'newer' })
    store.upsert(account('b'))
    store.flush()
    expect(readFileSync(file, 'utf8')).toBe(text)
    expect(readdirSync(dirname(file)).filter((f) => f.includes('corrupt'))).toEqual([])
  })
})

describe('writing', () => {
  it('waits for a burst of changes to settle, then writes once', () => {
    vi.useFakeTimers()
    const file = tempFile()
    const store = new Store(file, 250)
    for (const id of ['a', 'b', 'c']) store.upsert(account(id))
    expect(existsSync(file)).toBe(false)
    vi.advanceTimersByTime(249)
    expect(existsSync(file)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(read(file).accounts).toHaveLength(3)
    // Nothing left behind but the file itself.
    expect(readdirSync(dirname(file))).toEqual(['accounts.json'])
  })

  it('flush writes straight away (on quit) and cancels the pending write', () => {
    vi.useFakeTimers()
    const file = tempFile()
    const store = new Store(file, 250)
    store.upsert(account('a'))
    store.flush()
    expect(read(file).accounts).toHaveLength(1)
    writeFileSync(file, 'changed elsewhere')
    vi.advanceTimersByTime(1000)
    expect(readFileSync(file, 'utf8')).toBe('changed elsewhere')
  })

  it('keeps unsaved changes after a failed write and tries again', () => {
    const file = tempFile()
    const store = new Store(file)
    store.upsert(account('a'))
    // A folder where the temp file should go makes the write fail.
    mkdirSync(`${file}.tmp`)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    store.flush()
    expect(existsSync(file)).toBe(false)
    rmdirSync(`${file}.tmp`)
    store.flush()
    expect(read(file).accounts).toHaveLength(1)
  })
})
