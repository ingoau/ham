import type {
  AppState,
  Bounds,
  ProfileInput,
  RefreshResult,
  SaveResult,
  SignInResult,
  HamEvent
} from './types'

/** The API the preload script exposes to the renderer as `window.ham`. */
export interface HamApi {
  getState(): Promise<AppState>

  signIn: {
    /** Start a sign-in. Pass `accountId` to sign an existing, signed-out account in again. */
    start(email: string, accountId?: string): Promise<SignInResult>
    submitEmailCode(attemptId: string, code: string): Promise<SignInResult>
    submitSecondFactor(attemptId: string, kind: 'totp' | 'backup', code: string): Promise<SignInResult>
    resend(attemptId: string): Promise<SignInResult>
    cancel(attemptId: string): Promise<void>
  }

  accounts: {
    refresh(accountId: string): Promise<RefreshResult>
    save(accountId: string, profile: ProfileInput): Promise<SaveResult>
    signOut(accountId: string): Promise<{ serverSignedOut: boolean }>
    move(accountId: string, toIndex: number): Promise<void>
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
  | 'signIn.start'
  | 'signIn.submitEmailCode'
  | 'signIn.submitSecondFactor'
  | 'signIn.resend'
  | 'signIn.cancel'
  | 'accounts.refresh'
  | 'accounts.save'
  | 'accounts.signOut'
  | 'accounts.move'
  | 'dashboard.show'
  | 'dashboard.setBounds'
  | 'dashboard.hide'
  | 'dashboard.back'
  | 'dashboard.home'
  | 'dashboard.reload'
  | 'dashboard.popOut'
  | 'openExternal'
  | 'dismissUpdate'
