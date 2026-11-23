// Persists accounts, settings and window state as JSON in the app's data
// folder. Session cookies never live here: Chromium keeps those (encrypted) in
// each account's partition. The only secret is the linked inbox's app
// password, which is encrypted with safeStorage before it's written.
import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_VIEW, type Account, type Theme, type ViewSettings } from '@shared/types'

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
  version: 2
  accounts: StoredAccount[]
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

/** Bring a v1 store (before pending accounts) up to v2. */
function migrate(raw: Record<string, unknown>): StoreFile {
  const accounts = (Array.isArray(raw.accounts) ? raw.accounts : []) as Partial<StoredAccount>[]
  return {
    version: 2,
    accounts: accounts.map((a) => ({
      id: a.id!,
      email: a.email!,
      firstName: a.firstName ?? '',
      lastName: a.lastName ?? '',
      phone: a.phone ?? '',
      hasLegalName: a.hasLegalName ?? false,
      status: a.status ?? 'signed-out',
      fresh: a.fresh ?? false,
      pinned: a.pinned ?? false,
      expiresAt: a.expiresAt ?? null,
      addedAt: a.addedAt ?? new Date().toISOString(),
      pending: a.pending ?? EMPTY_PENDING,
      slack: a.slack ?? { linked: null, session: false, profile: {} },
      partition: a.partition!,
      attemptPath: a.attemptPath ?? null
    })),
    window: raw.window as WindowState | undefined,
    dismissedUpdate: raw.dismissedUpdate as string | undefined,
    theme: (raw.theme as Theme) ?? 'system',
    view: { ...DEFAULT_VIEW, ...((raw.view as Partial<ViewSettings>) ?? {}) },
    inbox: (raw.inbox as InboxSettings | null) ?? null,
    loginLog: (raw.loginLog as number[]) ?? [],
    checkLog: (raw.checkLog as number[]) ?? []
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

  remove(id: string) {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id)
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
