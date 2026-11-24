// Persists accounts, settings and window state as JSON in the app's data
// folder. Session cookies never live here: Chromium keeps those (encrypted) in
// each account's partition. The only secret is the linked inbox's app
// password, which is encrypted with safeStorage before it's written.
import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
  const accounts = (Array.isArray(raw.accounts) ? raw.accounts : []) as Partial<StoredAccount>[]
  return {
    version: 3,
    accounts: accounts.map((a) => ({
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
    loginLog: (raw.loginLog as number[]) ?? [],
    checkLog: (raw.checkLog as number[]) ?? []
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

  constructor(file = join(app.getPath('userData'), 'accounts.json')) {
    this.file = file
    this.data = this.load()
  }

  private load(): StoreFile {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>
      if (raw && Array.isArray(raw.accounts)) return migrate(raw)
    } catch {
      // first run, or an unreadable file: start empty
    }
    return migrate({})
  }

  flush() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
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
    this.flush()
  }

  /** Put accounts in the given order (manual sort). Ids not listed keep their place at the end. */
  reorder(ids: string[]) {
    const byId = new Map(this.data.accounts.map((a) => [a.id, a]))
    const listed = ids.map((id) => byId.get(id)).filter((a): a is StoredAccount => !!a)
    const rest = this.data.accounts.filter((a) => !ids.includes(a.id))
    this.data.accounts = [...listed, ...rest]
    this.flush()
  }

  get groups(): AccountGroup[] {
    return this.data.groups
  }
  set groups(groups: AccountGroup[]) {
    this.data.groups = groups
    // Accounts in a group that no longer exists become ungrouped.
    const ids = new Set(groups.map((g) => g.id))
    this.data.accounts = this.data.accounts.map((a) => (a.groupId && !ids.has(a.groupId) ? { ...a, groupId: null } : a))
    this.flush()
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
    this.flush()
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
    this.flush()
  }

  get slackFields(): SlackFieldDef[] {
    return this.data.slackFields
  }
  set slackFields(fields: SlackFieldDef[]) {
    this.data.slackFields = fields
    this.flush()
  }

  get window(): WindowState | undefined {
    return this.data.window
  }
  set window(state: WindowState | undefined) {
    this.data.window = state
    this.flush()
  }

  get dismissedUpdate(): string | undefined {
    return this.data.dismissedUpdate
  }
  set dismissedUpdate(version: string | undefined) {
    this.data.dismissedUpdate = version
    this.flush()
  }

  get theme(): Theme {
    return this.data.theme
  }
  set theme(theme: Theme) {
    this.data.theme = theme
    this.flush()
  }

  get view(): ViewSettings {
    return this.data.view
  }
  set view(view: ViewSettings) {
    this.data.view = view
    this.flush()
  }

  get inbox(): InboxSettings | null {
    return this.data.inbox
  }
  set inbox(inbox: InboxSettings | null) {
    this.data.inbox = inbox
    this.flush()
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
    this.flush()
  }
}
