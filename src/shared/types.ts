// Types shared by the main process, the preload bridge and the renderer.

/**
 * Where an account is. The first two are settled; the rest are a sign-in in
 * progress (or stuck), shown inline in the account's detail pane.
 */
export type AccountStatus =
  | 'signed-in'
  | 'signed-out'
  | 'queued' // waiting for a free sign-in slot (rate limits)
  | 'sending' // asking auth.hackclub.com to email a code
  | 'waiting' // waiting for the emailed code
  | 'needs2fa' // email code accepted, authenticator or backup code needed
  | 'failed' // no account for this email, or the server refused
  | 'stuck' // 2FA required and a passkey is the only second factor

export const PENDING_STATUSES: readonly AccountStatus[] = ['queued', 'sending', 'waiting', 'needs2fa', 'failed', 'stuck']
export const isPending = (s: AccountStatus) => PENDING_STATUSES.includes(s)

export interface PendingInfo {
  /** When the current login attempt started (codes expire 15 minutes later). */
  startedAt: string | null
  /** For queued accounts: when the next free sign-in slot opens. */
  startsAt: string | null
  /** A code found in the linked inbox, shown while it's submitted. */
  autoCode: string | null
  /** Second factor form to show for needs2fa. */
  second: 'totp' | 'backup'
  /** Latest problem to show inline (a wrong code, a server message). */
  message: string | null
  /** The 15-minute attempt ran out and no inbox could restart it. */
  expired: boolean
}

/** Slack profile values, keyed by the bulk-edit field keys (real_name, display_name, …). */
export type SlackProfile = Record<string, string>

export interface SlackInfo {
  /** Whether the account has a Hack Club Slack user (from HCA's /slack-id). null = not known yet. */
  linked: boolean | null
  /** The Slack user id, when linked. */
  id?: string
  /** Whether this account's partition holds a Slack session cookie. */
  session: boolean
  profile: SlackProfile
}

export interface Account {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string
  /** The server has a separate legal name on file that HAM can't change. */
  hasLegalName: boolean
  status: AccountStatus
  /** True until the account has signed in once; it's shown by email until then. */
  fresh: boolean
  /** Pinned accounts sit in their own section at the top of the list. */
  pinned: boolean
  /** The user's own group (see AppState.groups), or null for ungrouped. */
  groupId: string | null
  /** ISO date the session cookie expires (or expired). */
  expiresAt: string | null
  addedAt: string
  pending: PendingInfo | null
  slack: SlackInfo
}

export interface AppInfo {
  version: string
  platform: string
  mock: boolean
}

export interface UpdateInfo {
  version: string
  url: string
}

export type Theme = 'system' | 'light' | 'dark'

export type LineKind = 'hca' | 'sfull' | 'sdisplay' | 'email' | 'tpl' | 'none'
export type SortBy = 'manual' | 'line1' | 'hca' | 'sdisplay' | 'email' | 'added' | 'status'
export type GroupBy = 'none' | 'status' | 'domain' | 'slack' | 'tpl'

export interface ViewSettings {
  sortBy: SortBy
  sortDir: 'asc' | 'desc'
  groupBy: GroupBy
  groupTpl: string
  line1: Exclude<LineKind, 'none'>
  line1Tpl: string
  line2: LineKind
  line2Tpl: string
  /** Collapsed groups, keyed "<groupBy>:<group name>". */
  collapsed: Record<string, boolean>
}

export const DEFAULT_VIEW: ViewSettings = {
  sortBy: 'line1',
  sortDir: 'asc',
  groupBy: 'none',
  groupTpl: '{{ account.title | default("No title") }}',
  line1: 'hca',
  line1Tpl: '{{ account.first }} {{ account.last }}',
  line2: 'email',
  line2Tpl: '{{ account.email }}',
  collapsed: {}
}

export interface InboxStatus {
  state: 'off' | 'connecting' | 'connected' | 'error'
  email: string | null
  host: string | null
  error: string | null
}

/** A group the user made to organise accounts. */
export interface AccountGroup {
  id: string
  name: string
}

export interface AppState {
  accounts: Account[]
  /** The user's groups, in display order. */
  groups: AccountGroup[]
  info: AppInfo
  update: UpdateInfo | null
  theme: Theme
  view: ViewSettings
  inbox: InboxStatus
}

/** One entry in a native context menu built by the renderer. */
export type ContextMenuItem =
  | { type: 'separator' }
  | { id: string; label: string; enabled?: boolean; checked?: boolean; accelerator?: string }
  | { label: string; submenu: ContextMenuItem[] }

export type CodeResult = { ok: true } | { ok: false; message: string }

export type SaveResult =
  | { ok: true; account: Account }
  | { ok: false; reason: 'validation'; messages: string[] }
  | { ok: false; reason: 'signed-out' }
  | { ok: false; reason: 'network' | 'unexpected'; message: string }

export type RefreshResult =
  | { ok: true; account: Account }
  | { ok: false; reason: 'signed-out' | 'network' | 'unexpected'; message?: string }

export interface ProfileInput {
  firstName: string
  lastName: string
  phone: string
}

export interface ImapLinkInput {
  email: string
  password: string
  host: string
}

export type FindResult = { ok: true; addresses: string[] } | { ok: false; message: string }

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DashboardState {
  accountId: string
  url: string
  canGoBack: boolean
  loading: boolean
}

export type DashboardNotice =
  | { kind: 'sso'; accountId: string; url: string }
  | { kind: 'external'; accountId: string; url: string }

/** Commands from the app menu (and its keyboard shortcuts). */
export type MenuCommand =
  | { type: 'add-account' }
  | { type: 'open-palette' }
  | { type: 'open-settings' }
  | { type: 'save' }
  | { type: 'refresh' }
  | { type: 'toggle-tab' }
  | { type: 'select-index'; index: number }
  | { type: 'sign-out' }
  | { type: 'select-all' }
  | { type: 'deselect-all' }
  | { type: 'toggle-pin' }
  | { type: 'move'; direction: 'up' | 'down' }
  | { type: 'new-group' }

export type HamEvent =
  | { type: 'state'; state: AppState }
  | { type: 'menu'; command: MenuCommand }
  | { type: 'dashboard-state'; state: DashboardState }
  | { type: 'dashboard-notice'; notice: DashboardNotice }
  | { type: 'toast'; text: string; kind: 'success' | 'error' | 'info' }
