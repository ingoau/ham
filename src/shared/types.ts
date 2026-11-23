// Types shared by the main process, the preload bridge and the renderer.

export type AccountStatus = 'signed-in' | 'signed-out'

export interface Account {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string
  /** The server has a separate legal name on file that HAM can't change. */
  hasLegalName: boolean
  status: AccountStatus
  /** ISO date the session cookie expires (or expired). */
  expiresAt: string | null
  addedAt: string
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

export interface AppState {
  accounts: Account[]
  info: AppInfo
  update: UpdateInfo | null
}

/** Where a sign-in attempt goes next. */
export type SignInStep =
  | { step: 'code'; email: string }
  | { step: 'totp' }
  | { step: 'backup' }
  /** 2FA is required and a passkey is the only second factor offered. */
  | { step: 'passkey-only' }
  | { step: 'done'; accountId: string; existing: boolean }

export type SignInError =
  | { error: 'no-account' }
  | { error: 'invalid-email' }
  | { error: 'invalid-code'; message: string }
  | { error: 'rate-limited' }
  | { error: 'locked'; message: string }
  | { error: 'network'; message: string }
  | { error: 'unexpected'; message: string }

export type SignInResult = (SignInStep | SignInError) & { attemptId: string }

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
  | { type: 'focus-search' }
  | { type: 'save' }
  | { type: 'refresh' }
  | { type: 'toggle-tab' }
  | { type: 'select-index'; index: number }
  | { type: 'sign-out' }

export type HamEvent =
  | { type: 'state'; state: AppState }
  | { type: 'menu'; command: MenuCommand }
  | { type: 'dashboard-state'; state: DashboardState }
  | { type: 'dashboard-notice'; notice: DashboardNotice }
