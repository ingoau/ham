import type {
  AppState,
  Bounds,
  CodeResult,
  FindResult,
  HamEvent,
  ImapLinkInput,
  ProfileInput,
  RefreshResult,
  SaveResult,
  Theme,
  UpdateInfo,
  ViewSettings
} from './types'

export type UpdateCheck = { status: 'available'; update: UpdateInfo } | { status: 'current' } | { status: 'unknown' }

/** The API the preload script exposes to the renderer as `window.ham`. */
export interface HamApi {
  getState(): Promise<AppState>

  accounts: {
    /** Add accounts by email. They appear straight away and sign in through the queue. */
    add(emails: string[]): Promise<{ added: string[]; existing: string[] }>
    submitCode(accountId: string, code: string): Promise<CodeResult>
    submitSecondFactor(accountId: string, kind: 'totp' | 'backup', code: string): Promise<CodeResult>
    /** Resend, try again, or sign a signed-out account in again (same partition). */
    restart(accountId: string): Promise<void>
    signInAgain(accountIds: string[]): Promise<void>
    /** Sign out (if signed in) and remove; cancels a pending sign-in. */
    remove(accountId: string): Promise<{ serverSignedOut: boolean; removed: boolean }>
    refresh(accountId: string): Promise<RefreshResult>
    save(accountId: string, profile: ProfileInput): Promise<SaveResult>
    launchSlack(accountId: string): Promise<void>
  }

  settings: {
    setTheme(theme: Theme): Promise<void>
    setView(view: ViewSettings): Promise<void>
    checkForUpdates(): Promise<UpdateCheck>
  }

  inbox: {
    link(input: ImapLinkInput): Promise<{ ok: true } | { ok: false; message: string }>
    unlink(): Promise<void>
    findAddresses(): Promise<FindResult>
  }

  dashboard: {
    show(accountId: string, bounds: Bounds): Promise<void>
    setBounds(bounds: Bounds): Promise<void>
    hide(): Promise<void>
    back(): Promise<void>
    home(): Promise<void>
    reload(): Promise<void>
    popOut(accountId: string): Promise<void>
  }

  openExternal(url: string): Promise<void>
  dismissUpdate(): Promise<void>

  /** Subscribe to events from the main process. Returns an unsubscribe function. */
  onEvent(listener: (event: HamEvent) => void): () => void
}

export const IPC = {
  invoke: 'ham:invoke',
  event: 'ham:event'
} as const

/** A flat list of the invokable methods, used to route `ham:invoke` calls. */
export type InvokeMethod =
  | 'getState'
  | 'accounts.add'
  | 'accounts.submitCode'
  | 'accounts.submitSecondFactor'
  | 'accounts.restart'
  | 'accounts.signInAgain'
  | 'accounts.remove'
  | 'accounts.refresh'
  | 'accounts.save'
  | 'accounts.launchSlack'
  | 'settings.setTheme'
  | 'settings.setView'
  | 'settings.checkForUpdates'
  | 'inbox.link'
  | 'inbox.unlink'
  | 'inbox.findAddresses'
  | 'dashboard.show'
  | 'dashboard.setBounds'
  | 'dashboard.hide'
  | 'dashboard.back'
  | 'dashboard.home'
  | 'dashboard.reload'
  | 'dashboard.popOut'
  | 'openExternal'
  | 'dismissUpdate'
