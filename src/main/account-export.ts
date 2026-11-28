// The account list as a file: emails and how they're organised, to move to
// another computer. No sessions, tokens, inbox details or HAM's own ids: groups
// and tags travel by name, and accounts sign in again after an import.
import { NO_TAGS, TAG_COLORS, type Account, type AccountGroup, type AccountTag, type GroupBy, type LineKind, type SortBy, type StatusFilter, type TagColor, type ViewSettings } from '@shared/types'

export const EXPORT_FORMAT = 'ham-accounts'
export const EXPORT_VERSION = 1
/** Bigger files aren't read. */
export const MAX_EXPORT_BYTES = 20 * 1024 * 1024
const MAX_ACCOUNTS = 10_000
const MAX_NAMES = 1_000

export interface ExportedAccount {
  email: string
  localName: string
  /** Its group's name, or null for ungrouped. */
  group: string | null
  /** Its tags' names. */
  tags: string[]
  pinned: boolean
}

/** View settings with tags by name. Collapsed sections stay behind. */
export interface ExportedView {
  sortBy: SortBy
  sortDir: 'asc' | 'desc'
  groupBy: GroupBy
  groupTpl: string
  line1: Exclude<LineKind, 'none'>
  line1Tpl: string
  line2: LineKind
  line2Tpl: string
  filter: { tags: string[]; untagged: boolean; tagMode: 'any' | 'all'; status: StatusFilter[] }
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: string
  /** In list order (the manual sort). */
  accounts: ExportedAccount[]
  /** In display order. */
  groups: { name: string }[]
  tags: { name: string; color: TagColor }[]
  /** Null in a file without view settings. */
  view: ExportedView | null
}

interface Source {
  accounts: Account[]
  groups: AccountGroup[]
  tags: AccountTag[]
  view: ViewSettings
}

/** The file for every account, or only `ids` (with just the groups and tags they use). */
export function buildExport(src: Source, ids: string[] | null, now = new Date()): ExportFile {
  const only = ids && ids.length ? new Set(ids) : null
  const accounts = only ? src.accounts.filter((a) => only.has(a.id)) : src.accounts
  const groupName = new Map(src.groups.map((g) => [g.id, g.name]))
  const tagName = new Map(src.tags.map((t) => [t.id, t.name]))
  const usedGroups = new Set(accounts.map((a) => a.groupId))
  const usedTags = new Set(accounts.flatMap((a) => a.tagIds))
  const { collapsed: _collapsed, filter, ...view } = src.view
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    accounts: accounts.map((a) => ({
      email: a.email,
      localName: a.localName,
      group: (a.groupId && groupName.get(a.groupId)) ?? null,
      tags: a.tagIds.map((t) => tagName.get(t)).filter((n): n is string => n !== undefined),
      pinned: a.pinned
    })),
    groups: src.groups.filter((g) => !only || usedGroups.has(g.id)).map((g) => ({ name: g.name })),
    tags: src.tags.filter((t) => !only || usedTags.has(t.id)).map((t) => ({ name: t.name, color: t.color })),
    view: {
      ...view,
      filter: {
        tags: filter.tags.map((t) => tagName.get(t)).filter((n): n is string => n !== undefined),
        untagged: filter.tags.includes(NO_TAGS),
        tagMode: filter.tagMode,
        status: filter.status
      }
    }
  }
}

/** "HAM accounts 2026-11-28.json", by the local date. */
export function exportFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `HAM accounts ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

// --- reading -----------------------------------------------------------------

export type ParseResult = { ok: true; file: ExportFile } | { ok: false; message: string }

class Invalid extends Error {}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SORTS: SortBy[] = ['manual', 'line1', 'hca', 'sdisplay', 'email', 'added', 'status']
const GROUP_BYS: GroupBy[] = ['none', 'status', 'domain', 'slack', 'tpl']
const LINES: LineKind[] = ['best', 'local', 'hca', 'sfull', 'sdisplay', 'email', 'tpl', 'none']
const STATUSES: StatusFilter[] = ['signed-in', 'signed-out', 'attention', 'adding']

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)

function text(v: unknown, what: string, max: number, empty = false): string {
  if (typeof v !== 'string') throw new Invalid(`${what} isn’t text.`)
  const s = clean(v, max)
  if (!s && !empty) throw new Invalid(`${what} is empty.`)
  return s
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (!allowed.includes(v as T)) throw new Invalid(`${what} isn’t valid.`)
  return v as T
}

function list(v: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(v)) throw new Invalid(`${what} isn’t a list.`)
  if (v.length > max) throw new Invalid(`Too many ${what.toLowerCase()} (at most ${max}).`)
  return v
}

/** Distinct by lower-cased name, first one wins. */
function distinct<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function readAccount(v: unknown, n: number): ExportedAccount {
  const what = `Account ${n}`
  if (!isObject(v)) throw new Invalid(`${what} isn’t valid.`)
  const email = text(v.email, `${what}’s email`, 320).toLowerCase()
  if (!EMAIL.test(email)) throw new Invalid(`${what}’s email isn’t valid.`)
  if (v.pinned !== undefined && typeof v.pinned !== 'boolean') throw new Invalid(`${what}’s pinned isn’t true or false.`)
  return {
    email,
    localName: v.localName === undefined ? '' : text(v.localName, `${what}’s local name`, 60, true),
    group: v.group === undefined || v.group === null ? null : text(v.group, `${what}’s group`, 60),
    tags: distinct(
      (v.tags === undefined ? [] : list(v.tags, `${what}’s tags`, MAX_NAMES)).map((t) => text(t, `${what}’s tag`, 40)),
      (t) => t
    ),
    pinned: v.pinned === true
  }
}

function readView(v: unknown): ExportedView {
  if (!isObject(v)) throw new Invalid('The view settings aren’t valid.')
  const f = v.filter === undefined ? {} : v.filter
  if (!isObject(f)) throw new Invalid('The view filter isn’t valid.')
  const tpl = (x: unknown, what: string) => {
    if (typeof x !== 'string') throw new Invalid(`${what} isn’t text.`)
    return x.slice(0, 2000)
  }
  return {
    sortBy: oneOf(v.sortBy, SORTS, 'The sort order'),
    sortDir: oneOf(v.sortDir, ['asc', 'desc'] as const, 'The sort direction'),
    groupBy: oneOf(v.groupBy, GROUP_BYS, 'Group by'),
    groupTpl: tpl(v.groupTpl, 'The group template'),
    line1: oneOf(v.line1, LINES.filter((l): l is Exclude<LineKind, 'none'> => l !== 'none'), 'The first line'),
    line1Tpl: tpl(v.line1Tpl, 'The first line template'),
    line2: oneOf(v.line2, LINES, 'The second line'),
    line2Tpl: tpl(v.line2Tpl, 'The second line template'),
    filter: {
      tags: distinct((f.tags === undefined ? [] : list(f.tags, 'Filter tags', MAX_NAMES)).map((t) => text(t, 'A filter tag', 40)), (t) => t),
      untagged: f.untagged === true,
      tagMode: f.tagMode === 'all' ? 'all' : 'any',
      status: f.status === undefined ? [] : [...new Set(list(f.status, 'Filter statuses', STATUSES.length).map((s) => oneOf(s, STATUSES, 'A filter status')))]
    }
  }
}

/** Check a file's text strictly: anything HAM doesn't understand is refused, with why. */
export function parseExport(raw: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, message: 'This file isn’t a HAM accounts file.' }
  }
  if (!isObject(data) || data.format !== EXPORT_FORMAT) return { ok: false, message: 'This file isn’t a HAM accounts file.' }
  if (typeof data.version !== 'number') return { ok: false, message: 'This file has no version.' }
  if (data.version > EXPORT_VERSION) return { ok: false, message: 'This file is from a newer version of HAM. Update HAM to import it.' }
  if (data.version !== EXPORT_VERSION) return { ok: false, message: `HAM can’t read version ${data.version} of this file.` }
  try {
    const accounts = distinct(
      list(data.accounts, 'Accounts', MAX_ACCOUNTS).map((a, i) => readAccount(a, i + 1)),
      (a) => a.email
    )
    const groups = distinct(
      (data.groups === undefined ? [] : list(data.groups, 'Groups', MAX_NAMES)).map((g, i) => {
        if (!isObject(g)) throw new Invalid(`Group ${i + 1} isn’t valid.`)
        return { name: text(g.name, `Group ${i + 1}’s name`, 60) }
      }),
      (g) => g.name
    )
    const tags = distinct(
      (data.tags === undefined ? [] : list(data.tags, 'Tags', MAX_NAMES)).map((t, i) => {
        if (!isObject(t)) throw new Invalid(`Tag ${i + 1} isn’t valid.`)
        return { name: text(t.name, `Tag ${i + 1}’s name`, 40), color: t.color === undefined ? ('gray' as const) : oneOf(t.color, TAG_COLORS, `Tag ${i + 1}’s colour`) }
      }),
      (t) => t.name
    )
    return {
      ok: true,
      file: {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
        accounts,
        groups,
        tags,
        view: data.view === undefined ? null : readView(data.view)
      }
    }
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, message: err.message }
    throw err
  }
}

// --- planning ------------------------------------------------------------------

export interface ImportPlan {
  /** Accounts HAM doesn't have yet, in the file's order. */
  fresh: ExportedAccount[]
  /** Emails already in HAM: left as they are. */
  existing: string[]
  /** Groups the new accounts need that HAM doesn't have, in the file's order. */
  newGroups: string[]
  /** Likewise for tags, with their colours. */
  newTags: { name: string; color: TagColor }[]
  view: ExportedView | null
}

const lower = (s: string) => s.toLowerCase()

/** Which accounts are new (emails match ignoring case) and which groups and tags they need made. */
export function planImport(file: ExportFile, have: { accounts: { email: string }[]; groups: { name: string }[]; tags: { name: string }[] }): ImportPlan {
  const emails = new Set(have.accounts.map((a) => lower(a.email)))
  const fresh = file.accounts.filter((a) => !emails.has(lower(a.email)))
  const existing = file.accounts.filter((a) => emails.has(lower(a.email))).map((a) => a.email)

  const groupsHave = new Set(have.groups.map((g) => lower(g.name)))
  const groupsNeeded = new Set(fresh.map((a) => a.group).filter((g): g is string => !!g).map(lower))
  // The file's order first, then any the file's group list missed.
  const groupOrder = distinct([...file.groups.map((g) => g.name), ...fresh.map((a) => a.group).filter((g): g is string => !!g)], (g) => g)
  const newGroups = groupOrder.filter((g) => groupsNeeded.has(lower(g)) && !groupsHave.has(lower(g)))

  const tagsHave = new Set(have.tags.map((t) => lower(t.name)))
  const tagsNeeded = new Set(fresh.flatMap((a) => a.tags).map(lower))
  const tagOrder = distinct([...file.tags, ...fresh.flatMap((a) => a.tags).map((name) => ({ name, color: 'gray' as TagColor }))], (t) => t.name)
  const newTags = tagOrder.filter((t) => tagsNeeded.has(lower(t.name)) && !tagsHave.has(lower(t.name)))

  return { fresh, existing, newGroups, newTags, view: file.view }
}

/** An imported view as settings: tag names become ids (unknown ones drop out); collapsed sections are kept. */
export function viewFromImport(view: ExportedView, tags: AccountTag[], current: ViewSettings): ViewSettings {
  const ids = new Map(tags.map((t) => [lower(t.name), t.id]))
  const { filter, ...rest } = view
  const tagIds = filter.tags.map((n) => ids.get(lower(n))).filter((id): id is string => !!id)
  return {
    ...rest,
    collapsed: current.collapsed,
    filter: { tags: [...tagIds, ...(filter.untagged ? [NO_TAGS] : [])], tagMode: filter.tagMode, status: filter.status }
  }
}
