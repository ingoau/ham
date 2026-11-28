// Persists accounts, settings and window state as JSON in the app's data
// folder. Session cookies never live here: Chromium keeps those (encrypted) in
// each account's partition. The only secret is the linked inbox's app
// password, which is encrypted with safeStorage before it's written.
import { app } from 'electron'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { migrateTemplate } from '@shared/fields'
import { DEFAULT_VIEW, EMPTY_FILTER, NO_TAGS, TAG_COLORS, type Account, type AccountGroup, type AccountTag, type SlackFieldDef, type Theme, type ViewSettings } from '@shared/types'

export interface StoredAccount extends Account {
  /** Electron session partition holding this account's cookies. */
  partition: string
  /** The in-progress login attempt (e.g. "/login/AbC123"), so it survives a restart. */
  attemptPath: string | null
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

export interface InboxSettings {
  email: string
  host: string
  port: number
  /** safeStorage-encrypted app password, base64. */
  passwordEnc: string
  /** Folders where Hack Club Auth mail has turned up (filters often move it out of INBOX). */
  folders: string[]
}

/** The newest file format this build reads and writes. */
export const STORE_VERSION = 3
/** Changes come in bursts (a bulk tag, a queue tick): write once they settle. */
const WRITE_DELAY = 250

/** Why the saved accounts couldn't be used as they were. */
export type StoreProblem =
  /** Unreadable, so moved aside to `backup`. Restored from the last write's temp file, or started empty. */
  | { kind: 'corrupt'; backup: string; restored: boolean }
  /** Saved by a newer HAM, or unreadable and couldn't be moved aside: nothing is written over it. */
  | { kind: 'read-only'; reason: 'newer' | 'unreadable' }

interface StoreFile {
  version: 3
  accounts: StoredAccount[]
  groups: AccountGroup[]
  tags: AccountTag[]
  /** Hack Club Slack's own profile fields, as last read from Slack. */
  slackFields: SlackFieldDef[]
  window?: WindowState
  dismissedUpdate?: string
  theme: Theme
  view: ViewSettings
  inbox: InboxSettings | null
  /** Sign accounts on Slack in to Slack automatically. */
  autoSlack: boolean
  /** Timestamps of recent POST /login and code checks, for the rate limits. */
  loginLog: number[]
  checkLog: number[]
}

const EMPTY_PENDING = null

/** Bring an older store up to v3 (v2: pending accounts, v3: best-name first line) and fill in newer fields. */
function migrate(raw: Record<string, unknown>): StoreFile {
  const version = typeof raw.version === 'number' ? raw.version : 1
  const view = withDefaults((raw.view as Partial<ViewSettings>) ?? {})
  // The first line's default moved from the Hack Club name to the best name.
  if (version < 3 && view.line1 === 'hca') view.line1 = 'best'
  const accounts = (Array.isArray(raw.accounts) ? raw.accounts : []) as (Partial<StoredAccount> | null)[]
  return {
    version: 3,
    // A row without these can't be shown or signed in: drop it rather than crash on it.
    accounts: accounts.filter(isUsable).map((a) => ({
      id: a.id!,
      email: a.email!,
      localName: a.localName ?? '',
      firstName: a.firstName ?? '',
      lastName: a.lastName ?? '',
      phone: a.phone ?? '',
      hasLegalName: a.hasLegalName ?? false,
      status: a.status ?? 'signed-out',
      fresh: a.fresh ?? false,
      pinned: a.pinned ?? false,
      groupId: a.groupId ?? null,
      tagIds: Array.isArray(a.tagIds) ? a.tagIds.filter((t) => typeof t === 'string') : [],
      expiresAt: a.expiresAt ?? null,
      addedAt: a.addedAt ?? new Date().toISOString(),
      pending: a.pending ?? EMPTY_PENDING,
      slack: a.slack ?? { linked: null, session: false, profile: {} },
      partition: a.partition!,
      attemptPath: a.attemptPath ?? null
    })),
    groups: Array.isArray(raw.groups) ? (raw.groups as AccountGroup[]).filter((g) => g && typeof g.id === 'string') : [],
    tags: Array.isArray(raw.tags)
      ? (raw.tags as AccountTag[])
          .filter((t) => t && typeof t.id === 'string')
          .map((t) => ({ id: t.id, name: String(t.name ?? ''), color: TAG_COLORS.includes(t.color) ? t.color : 'gray' }))
      : [],
    slackFields: Array.isArray(raw.slackFields) ? (raw.slackFields as SlackFieldDef[]).filter((f) => f && typeof f.id === 'string' && typeof f.key === 'string') : [],
    window: raw.window as WindowState | undefined,
    dismissedUpdate: raw.dismissedUpdate as string | undefined,
    theme: (raw.theme as Theme) ?? 'system',
    view: migrateView(view),
    inbox: (raw.inbox as InboxSettings | null) ?? null,
    autoSlack: raw.autoSlack === true,
    loginLog: (raw.loginLog as number[]) ?? [],
    checkLog: (raw.checkLog as number[]) ?? []
  }
}

function isUsable(a: Partial<StoredAccount> | null): a is Partial<StoredAccount> {
  return !!a && typeof a === 'object' && !!a.id && typeof a.id === 'string' && !!a.partition && typeof a.partition === 'string' && typeof a.email === 'string'
}

type ReadResult = { kind: 'ok'; raw: Record<string, unknown> } | { kind: 'missing' } | { kind: 'bad'; error: unknown }

function readRaw(file: string): ReadResult {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'bad', error: err }
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null
    if (raw && typeof raw === 'object' && Array.isArray(raw.accounts)) return { kind: 'ok', raw }
    return { kind: 'bad', error: new Error('Not a HAM accounts file') }
  } catch (err) {
    return { kind: 'bad', error: err }
  }
}

function migrateView(view: ViewSettings): ViewSettings {
  return {
    ...view,
    groupTpl: migrateTemplate(view.groupTpl),
    line1Tpl: migrateTemplate(view.line1Tpl),
    line2Tpl: migrateTemplate(view.line2Tpl)
  }
}

/** Fill in view settings that older versions (or a bad caller) left out. */
export function withDefaults(view: Partial<ViewSettings>): ViewSettings {
  const f = view.filter
  return {
    ...DEFAULT_VIEW,
    ...view,
    filter: {
      tags: Array.isArray(f?.tags) ? f.tags.filter((t) => typeof t === 'string') : [],
      tagMode: f?.tagMode === 'all' ? 'all' : 'any',
      status: Array.isArray(f?.status) ? f.status.filter((s) => ['signed-in', 'signed-out', 'attention', 'adding'].includes(s)) : EMPTY_FILTER.status
    }
  }
}

export class Store {
  private data: StoreFile
  private readonly file: string
  private writable = true
  private dirty = false
  private timer: NodeJS.Timeout | null = null
  private loadProblem: StoreProblem | null = null

  constructor(
    file = join(app.getPath('userData'), 'accounts.json'),
    private readonly writeDelay = WRITE_DELAY
  ) {
    this.file = file
    this.data = this.load()
  }

  /** Set when the saved file couldn't be used as it was. */
  get problem(): StoreProblem | null {
    return this.loadProblem
  }

  private load(): StoreFile {
    const main = readRaw(this.file)
    if (main.kind === 'ok') return this.open(main.raw)
    // A write cut short before its rename leaves the newest data in the temp file.
    const tmp = readRaw(`${this.file}.tmp`)
    if (main.kind === 'missing') return tmp.kind === 'ok' ? this.open(tmp.raw) : migrate({})
    console.error('[store] unreadable', this.file, main.error)
    // Move it aside so the next write can't destroy it.
    const backup = `${this.file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      renameSync(this.file, backup)
    } catch {
      this.writable = false
      this.loadProblem = { kind: 'read-only', reason: 'unreadable' }
      return tmp.kind === 'ok' ? migrate(tmp.raw) : migrate({})
    }
    this.loadProblem = { kind: 'corrupt', backup, restored: tmp.kind === 'ok' }
    if (tmp.kind !== 'ok') return migrate({})
    const data = this.open(tmp.raw)
    // Restored: write it back as the real file.
    this.save()
    return data
  }

  private open(raw: Record<string, unknown>): StoreFile {
    if (typeof raw.version === 'number' && raw.version > STORE_VERSION) {
      this.writable = false
      this.loadProblem = { kind: 'read-only', reason: 'newer' }
    }
    return migrate(raw)
  }

  /** Write soon. */
  private save() {
    if (!this.writable) return
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.writeDelay)
    this.timer.unref?.()
  }

  /** Write any unsaved changes now (on quit). */
  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.dirty || !this.writable) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      const fd = openSync(tmp, 'w')
      try {
        writeFileSync(fd, JSON.stringify(this.data, null, 2))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(tmp, this.file)
      this.dirty = false
    } catch (err) {
      // Still dirty: the next change (or quitting) tries again.
      console.error("[store] couldn't save", err)
    }
  }

  get accounts(): StoredAccount[] {
    return this.data.accounts
  }

  find(id: string): StoredAccount | undefined {
    return this.data.accounts.find((a) => a.id === id)
  }

  findByEmail(email: string): StoredAccount | undefined {
    const lower = email.trim().toLowerCase()
    return this.data.accounts.find((a) => a.email.toLowerCase() === lower)
  }

  upsert(account: StoredAccount) {
    const i = this.data.accounts.findIndex((a) => a.id === account.id)
    if (i === -1) this.data.accounts.push(account)
    else this.data.accounts[i] = account
    this.save()
  }

  /** Put accounts in the given order (manual sort). Ids not listed keep their place at the end. */
  reorder(ids: string[]) {
    const byId = new Map(this.data.accounts.map((a) => [a.id, a]))
    const listed = ids.map((id) => byId.get(id)).filter((a): a is StoredAccount => !!a)
    const rest = this.data.accounts.filter((a) => !ids.includes(a.id))
    this.data.accounts = [...listed, ...rest]
    this.save()
  }

  get groups(): AccountGroup[] {
    return this.data.groups
  }
  set groups(groups: AccountGroup[]) {
    this.data.groups = groups
    // Accounts in a group that no longer exists become ungrouped.
    const ids = new Set(groups.map((g) => g.id))
    this.data.accounts = this.data.accounts.map((a) => (a.groupId && !ids.has(a.groupId) ? { ...a, groupId: null } : a))
    this.save()
  }

  get tags(): AccountTag[] {
    return this.data.tags
  }
  set tags(tags: AccountTag[]) {
    this.data.tags = tags
    // A deleted tag comes off every account and out of the filter.
    const ids = new Set(tags.map((t) => t.id))
    this.data.accounts = this.data.accounts.map((a) => (a.tagIds.every((t) => ids.has(t)) ? a : { ...a, tagIds: a.tagIds.filter((t) => ids.has(t)) }))
    this.data.view = this.pruneFilter(this.data.view)
    this.save()
  }

  /** Drop deleted tags from a view's filter ("No tags" too, once there are none). */
  pruneFilter(view: ViewSettings): ViewSettings {
    const ids = new Set(this.data.tags.map((t) => t.id))
    const keep = (t: string) => (t === NO_TAGS ? ids.size > 0 : ids.has(t))
    const f = view.filter
    return f.tags.every(keep) ? view : { ...view, filter: { ...f, tags: f.tags.filter(keep) } }
  }

  remove(id: string) {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id)
    this.save()
  }

  get slackFields(): SlackFieldDef[] {
    return this.data.slackFields
  }
  set slackFields(fields: SlackFieldDef[]) {
    this.data.slackFields = fields
    this.save()
  }

  get window(): WindowState | undefined {
    return this.data.window
  }
  set window(state: WindowState | undefined) {
    this.data.window = state
    this.save()
  }

  get dismissedUpdate(): string | undefined {
    return this.data.dismissedUpdate
  }
  set dismissedUpdate(version: string | undefined) {
    this.data.dismissedUpdate = version
    this.save()
  }

  get theme(): Theme {
    return this.data.theme
  }
  set theme(theme: Theme) {
    this.data.theme = theme
    this.save()
  }

  get view(): ViewSettings {
    return this.data.view
  }
  set view(view: ViewSettings) {
    this.data.view = view
    this.save()
  }

  get inbox(): InboxSettings | null {
    return this.data.inbox
  }
  set inbox(inbox: InboxSettings | null) {
    this.data.inbox = inbox
    this.save()
  }

  get autoSlack(): boolean {
    return this.data.autoSlack
  }
  set autoSlack(on: boolean) {
    this.data.autoSlack = on
    this.save()
  }

  get loginLog(): number[] {
    return this.data.loginLog
  }
  get checkLog(): number[] {
    return this.data.checkLog
  }
  saveLogs(loginLog: number[], checkLog: number[]) {
    this.data.loginLog = loginLog
    this.data.checkLog = checkLog
    this.save()
  }
}
