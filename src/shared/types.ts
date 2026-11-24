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

/**
 * Slack profile values, keyed by field id: the standard fields by name
 * (real_name, display_name, title, pronouns, tz, status_emoji, status_text) and
 * the workspace's own fields by Slack element id. A link field has two values,
 * "<id>.text" and "<id>.url"; a people field holds comma-separated user ids.
 */
export type SlackProfile = Record<string, string>

export type SlackFieldKind = 'text' | 'date' | 'link' | 'person'

/** One of the workspace's own profile fields, as Slack lists it (users.profile.getSections). */
export interface SlackFieldDef {
  /** Slack's element id ("Pe…"). */
  id: string
  /** The section it sits in ("Ps…"). Slack saves a section at a time. */
  section: string
  sectionLabel: string
  label: string
  hint: string
  kind: SlackFieldKind
  /** False for fields only admins (or SCIM) can set. */
  editable: boolean
  /** Its name in templates, under account.slack.fields (link fields add _text and _url). */
  key: string
}

export interface SlackInfo {
  /** Whether the account has a Hack Club Slack user (from HCA's /slack-id). null = not known yet. */
  linked: boolean | null
  /** The Slack user id, when linked. */
  id?: string
  /** Whether this account's partition holds a working Slack session. */
  session: boolean
  profile: SlackProfile
  /** Names for the user ids in people fields (manager and so on). */
  users?: Record<string, string>
  /** When the profile was last read from Slack. */
  fetchedAt?: string
}

export interface Account {
  id: string
  email: string
  /** A name only HAM shows (never sent to Hack Club). Empty for none. */
  localName: string
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
  /** The user's tags on this account (see AppState.tags). An account can have any number. */
  tagIds: string[]
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

export type LineKind = 'best' | 'local' | 'hca' | 'sfull' | 'sdisplay' | 'email' | 'tpl' | 'none'
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
  /** Which accounts the list shows. */
  filter: AccountFilter
}

/** Status buckets for the sidebar filter. */
export type StatusFilter = 'signed-in' | 'signed-out' | 'attention' | 'adding'

/** Stands in for "accounts without tags" in AccountFilter.tags. */
export const NO_TAGS = 'none'

export interface AccountFilter {
  /** Tag ids (or NO_TAGS). Empty: any tags. */
  tags: string[]
  /** With several tags: an account needs any of them, or all of them. */
  tagMode: 'any' | 'all'
  /** Empty: any status. */
  status: StatusFilter[]
}

export const EMPTY_FILTER: AccountFilter = { tags: [], tagMode: 'any', status: [] }

export const DEFAULT_VIEW: ViewSettings = {
  sortBy: 'line1',
  sortDir: 'asc',
  groupBy: 'none',
  groupTpl: '{{ account.slack.title | default("No title") }}',
  line1: 'best',
  line1Tpl: '{{ account.hca.first }} {{ account.hca.last }}',
  line2: 'email',
  line2Tpl: '{{ account.email }}',
  collapsed: {},
  filter: EMPTY_FILTER
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

export const TAG_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'] as const
export type TagColor = (typeof TAG_COLORS)[number]

/** A label the user made. Unlike groups, an account can have several. */
export interface AccountTag {
  id: string
  name: string
  color: TagColor
}

export interface AppState {
  accounts: Account[]
  /** Hack Club Slack's own profile fields, from the last profile HAM read. Empty until then. */
  slackFields: SlackFieldDef[]
  /** The user's groups, in display order. */
  groups: AccountGroup[]
  /** The user's tags, in display order. */
  tags: AccountTag[]
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

export type SlackSaveResult =
  | { ok: true; account: Account }
  /** Slack's session in this account has ended: open Slack again. */
  | { ok: false; reason: 'slack-signed-out' }
  | { ok: false; reason: 'rejected' | 'network'; message: string }

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

/** Where an address turned up: Hack Club Auth emails, or Hack Club Slack emails. */
export type MailSource = 'hca' | 'slack'

export interface FoundAddress {
  email: string
  sources: MailSource[]
  /** From HCA's public check: false means no Hack Club account uses this email; null if unknown. */
  hasAccount: boolean | null
}

export type FindResult = { ok: true; addresses: FoundAddress[] } | { ok: false; message: string }

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
  | { type: 'new-tag' }
  | { type: 'filter' }

export type HamEvent =
  | { type: 'state'; state: AppState }
  | { type: 'menu'; command: MenuCommand }
  | { type: 'dashboard-state'; state: DashboardState }
  | { type: 'dashboard-notice'; notice: DashboardNotice }
  | { type: 'toast'; text: string; kind: 'success' | 'error' | 'info' }
