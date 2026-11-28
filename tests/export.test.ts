import { tmpdir } from 'node:os'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW, NO_TAGS, type AccountGroup, type AccountTag } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
const { buildExport, exportFileName, parseExport, planImport, viewFromImport } = await import('../src/main/account-export')
const { Store } = await import('../src/main/store')
const { AccountService } = await import('../src/main/accounts')
const { account, removeTempDirs, tempFile } = await import('./main-helpers')
type ExportFile = import('../src/main/account-export').ExportFile
type Backend = import('../src/main/auth/backend').AuthBackend

const groups: AccountGroup[] = [
  { id: 'g1', name: 'Clubs' },
  { id: 'g2', name: 'Events' }
]
const tags: AccountTag[] = [
  { id: 't1', name: 'Lead', color: 'red' },
  { id: 't2', name: 'Test', color: 'blue' }
]
const accounts = [
  account('ada', { localName: 'Ada (main)', groupId: 'g1', tagIds: ['t1', 't2'], pinned: true, status: 'signed-in' }),
  account('bob', { groupId: null, tagIds: [], slack: { linked: true, id: 'U123', session: true, profile: { real_name: 'Bob' } } }),
  account('cy', { groupId: 'g2', tagIds: ['t2'] })
]
const view = { ...DEFAULT_VIEW, sortBy: 'manual' as const, collapsed: { 'group:g1': true }, filter: { tags: ['t1', NO_TAGS], tagMode: 'all' as const, status: ['signed-in' as const] } }
const src = { accounts, groups, tags, view }
const NOW = new Date(2026, 10, 28, 9, 30)

const fileText = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...buildExport(src, null, NOW), ...patch })

afterAll(removeTempDirs)

describe('buildExport', () => {
  it('keeps the list, its organisation and the view, by name', () => {
    const file = buildExport(src, null, NOW)
    expect(file).toMatchObject({ format: 'ham-accounts', version: 1, exportedAt: NOW.toISOString() })
    expect(file.accounts).toEqual([
      { email: 'ada@example.com', localName: 'Ada (main)', group: 'Clubs', tags: ['Lead', 'Test'], pinned: true },
      { email: 'bob@example.com', localName: '', group: null, tags: [], pinned: false },
      { email: 'cy@example.com', localName: '', group: 'Events', tags: ['Test'], pinned: false }
    ])
    expect(file.groups).toEqual([{ name: 'Clubs' }, { name: 'Events' }])
    expect(file.tags).toEqual([
      { name: 'Lead', color: 'red' },
      { name: 'Test', color: 'blue' }
    ])
    expect(file.view).toMatchObject({ sortBy: 'manual', filter: { tags: ['Lead'], untagged: true, tagMode: 'all', status: ['signed-in'] } })
    expect(file.view).not.toHaveProperty('collapsed')
  })

  it('never includes sessions, Slack data, partitions or ids', () => {
    const text = JSON.stringify(buildExport(src, null, NOW))
    for (const secret of ['partition', 'p-ada', 'U123', '"profile"', 'attemptPath', '"id"', 'g1', 't1', 'expiresAt', 'status":"signed-in"']) expect(text).not.toContain(secret)
  })

  it('exports only the chosen accounts, with only the groups and tags they use', () => {
    const file = buildExport(src, ['cy'], NOW)
    expect(file.accounts.map((a) => a.email)).toEqual(['cy@example.com'])
    expect(file.groups).toEqual([{ name: 'Events' }])
    expect(file.tags).toEqual([{ name: 'Test', color: 'blue' }])
  })

  it('names the file by the local date', () => {
    expect(exportFileName(NOW)).toBe('HAM accounts 2026-11-28.json')
  })
})

describe('parseExport', () => {
  it('reads back what buildExport wrote', () => {
    const r = parseExport(fileText())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file).toEqual(buildExport(src, null, NOW))
  })

  it('refuses files that aren’t HAM accounts files', () => {
    for (const text of ['not json', '[]', 'null', '{}', JSON.stringify({ format: 'other', version: 1, accounts: [] })]) {
      expect(parseExport(text)).toEqual({ ok: false, message: 'This file isn’t a HAM accounts file.' })
    }
  })

  it('refuses unknown versions', () => {
    expect(parseExport(fileText({ version: 2 }))).toMatchObject({ ok: false, message: expect.stringContaining('newer version') })
    expect(parseExport(fileText({ version: 0 }))).toMatchObject({ ok: false, message: expect.stringContaining('version 0') })
    expect(parseExport(fileText({ version: '1' }))).toMatchObject({ ok: false })
  })

  it('refuses malformed accounts, groups, tags and view settings, saying which', () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ accounts: 'x' }, 'Accounts isn’t a list.'],
      [{ accounts: [{ email: 'nope' }] }, 'Account 1’s email isn’t valid.'],
      [{ accounts: [{ email: 'a@b.co' }, { email: 3 }] }, 'Account 2’s email isn’t text.'],
      [{ accounts: [{ email: 'a@b.co', pinned: 'yes' }] }, 'Account 1’s pinned isn’t true or false.'],
      [{ accounts: [{ email: 'a@b.co', tags: [''] }] }, 'Account 1’s tag is empty.'],
      [{ groups: [{ name: 5 }] }, 'Group 1’s name isn’t text.'],
      [{ tags: [{ name: 'x', color: 'mauve' }] }, 'Tag 1’s colour isn’t valid.'],
      [{ view: { ...buildExport(src, null).view, sortBy: 'random' } }, 'The sort order isn’t valid.'],
      [{ view: 'wide' }, 'The view settings aren’t valid.']
    ]
    for (const [patch, message] of bad) expect(parseExport(fileText(patch))).toEqual({ ok: false, message })
  })

  it('tidies what it keeps: lower-case emails, one per address, no repeated names', () => {
    const r = parseExport(
      fileText({
        accounts: [
          { email: ' Ada@Example.com ', localName: '  Ada   L ', tags: ['Lead', 'lead'] },
          { email: 'ada@example.com', localName: 'second' }
        ],
        groups: [{ name: 'Clubs' }, { name: 'clubs' }],
        tags: [{ name: 'Lead' }],
        view: undefined
      })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.file.accounts).toEqual([{ email: 'ada@example.com', localName: 'Ada L', group: null, tags: ['Lead'], pinned: false }])
    expect(r.file.groups).toEqual([{ name: 'Clubs' }])
    expect(r.file.tags).toEqual([{ name: 'Lead', color: 'gray' }])
    expect(r.file.view).toBeNull()
  })
})

describe('planImport', () => {
  const file = (): ExportFile => {
    const r = parseExport(fileText())
    if (!r.ok) throw new Error(r.message)
    return r.file
  }

  it('splits new accounts from ones already in HAM, ignoring case', () => {
    const plan = planImport(file(), { accounts: [{ email: 'BOB@example.com' }], groups: [], tags: [] })
    expect(plan.fresh.map((a) => a.email)).toEqual(['ada@example.com', 'cy@example.com'])
    expect(plan.existing).toEqual(['bob@example.com'])
  })

  it('makes only the groups and tags new accounts need and HAM lacks', () => {
    const plan = planImport(file(), { accounts: [{ email: 'cy@example.com' }], groups: [{ name: 'clubs' }], tags: [{ name: 'TEST' }] })
    expect(plan.newGroups).toEqual([])
    expect(plan.newTags).toEqual([{ name: 'Lead', color: 'red' }])
    const empty = planImport(file(), { accounts: [], groups: [], tags: [] })
    expect(empty.newGroups).toEqual(['Clubs', 'Events'])
  })

  it('makes groups and tags accounts name even when the file’s lists leave them out', () => {
    const r = parseExport(fileText({ accounts: [{ email: 'z@example.com', group: 'Misc', tags: ['New'] }], groups: [], tags: [] }))
    if (!r.ok) throw new Error(r.message)
    const plan = planImport(r.file, { accounts: [], groups: [], tags: [] })
    expect(plan.newGroups).toEqual(['Misc'])
    expect(plan.newTags).toEqual([{ name: 'New', color: 'gray' }])
  })
})

describe('viewFromImport', () => {
  it('maps filter tags to ids by name and keeps collapsed sections', () => {
    const exported = buildExport(src, null).view!
    const mine: AccountTag[] = [{ id: 'x9', name: 'lead', color: 'red' }]
    const v = viewFromImport({ ...exported, filter: { ...exported.filter, tags: ['Lead', 'Gone'] } }, mine, { ...DEFAULT_VIEW, collapsed: { pinned: true } })
    expect(v.filter).toEqual({ tags: ['x9', NO_TAGS], tagMode: 'all', status: ['signed-in'] })
    expect(v.collapsed).toEqual({ pinned: true })
    expect(v.sortBy).toBe('manual')
  })
})

describe('importing into HAM', () => {
  afterEach(() => vi.useRealTimers())

  it('adds new accounts to the sign-in queue with their organisation and leaves existing ones alone', () => {
    vi.useFakeTimers()
    const store = new Store(tempFile())
    const bob = account('bob', { email: 'bob@example.com', localName: 'Keep me', pinned: false })
    store.upsert(bob)
    store.groups = [{ id: 'mine', name: 'clubs' }]
    const never = () => new Promise<never>(() => {})
    const backend = { startLogin: never, clearLocalData: async () => {}, attemptPath: () => null } as unknown as Backend
    const service = new AccountService(store, () => backend, () => {}, vi.fn())
    const r = parseExport(fileText())
    if (!r.ok) throw new Error(r.message)
    const plan = planImport(r.file, { accounts: service.list(), groups: store.groups, tags: store.tags })

    expect(service.importAccounts(plan)).toBe(2)
    service.stop()

    const ada = store.findByEmail('ada@example.com')!
    const cy = store.findByEmail('cy@example.com')!
    expect(ada).toMatchObject({ localName: 'Ada (main)', groupId: 'mine', pinned: true, fresh: true })
    expect(['queued', 'sending']).toContain(ada.status)
    expect(ada.tagIds.map((id) => store.tags.find((t) => t.id === id)?.name)).toEqual(['Lead', 'Test'])
    expect(store.groups.map((g) => g.name)).toEqual(['clubs', 'Events'])
    expect(cy.groupId).toBe(store.groups[1].id)
    expect(store.find('bob')).toEqual(bob)
    expect(store.accounts.map((a) => a.email)).toEqual(['bob@example.com', 'ada@example.com', 'cy@example.com'])
  })
})
