import type {
  AppState,
  Bounds,
  CodeResult,
  ContextMenuItem,
  FindResult,
  HamEvent,
  ImapLinkInput,
  ProfileInput,
  RefreshResult,
  SaveResult,
  SlackProfile,
  SlackSaveResult,
  SlackSignInResult,
  SlackTokensResult,
  TagColor,
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
    /** Save changed Slack profile values (keyed like SlackProfile) with the account's Slack session. */
    saveSlack(accountId: string, changes: SlackProfile): Promise<SlackSaveResult>
    launchSlack(accountId: string): Promise<void>
    /** Sign in to Slack in a hidden window (SAML through Hack Club), which closes once Slack has signed in. */
    signInSlack(accountId: string): Promise<SlackSignInResult>
    /** Sign out of Slack only; the Hack Club session stays. */
    signOutSlack(accountId: string): Promise<void>
    /** Sign in to Slack afresh in a throwaway session and return its tokens. HAM keeps nothing. */
    slackTokens(accountId: string): Promise<SlackTokensResult>
    /** Set the name only HAM shows; empty clears it. */
    setLocalName(accountId: string, name: string): Promise<void>
    setPinned(accountIds: string[], pinned: boolean): Promise<void>
    /** Save the manual order: every account id, top to bottom. */
    reorder(accountIds: string[]): Promise<void>
    /** Move accounts into a group, or out of one with null. Also unpins them. */
    setGroup(accountIds: string[], groupId: string | null): Promise<void>
    /** Add a tag to accounts (on) or take it off them. */
    setTag(accountIds: string[], tagId: string, on: boolean): Promise<void>
  }

  tags: {
    /** Make a tag (optionally adding it to accounts); resolves with its id. */
    create(name: string, color: TagColor, accountIds: string[]): Promise<string | null>
    update(tagId: string, patch: { name?: string; color?: TagColor }): Promise<void>
    /** Delete a tag; it comes off every account. */
    remove(tagId: string): Promise<void>
    reorder(tagIds: string[]): Promise<void>
  }

  groups: {
    /** Make a group (optionally moving accounts into it); resolves with its id. */
    create(name: string, accountIds: string[]): Promise<string | null>
    rename(groupId: string, name: string): Promise<void>
    /** Delete a group; its accounts become ungrouped. */
    remove(groupId: string): Promise<void>
    reorder(groupIds: string[]): Promise<void>
  }

  ui: {
    /** Show a native context menu; resolves with the chosen item's id, or null. */
    contextMenu(items: ContextMenuItem[]): Promise<string | null>
  }

  copyText(text: string): Promise<void>

  settings: {
    setTheme(theme: Theme): Promise<void>
    setView(view: ViewSettings): Promise<void>
    setAutoSlack(on: boolean): Promise<void>
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
  | 'accounts.saveSlack'
  | 'accounts.launchSlack'
  | 'accounts.signInSlack'
  | 'accounts.signOutSlack'
  | 'accounts.slackTokens'
  | 'accounts.setLocalName'
  | 'accounts.setPinned'
  | 'accounts.reorder'
  | 'accounts.setGroup'
  | 'groups.create'
  | 'groups.rename'
  | 'groups.remove'
  | 'groups.reorder'
  | 'accounts.setTag'
  | 'tags.create'
  | 'tags.update'
  | 'tags.remove'
  | 'tags.reorder'
  | 'ui.contextMenu'
  | 'copyText'
  | 'settings.setTheme'
  | 'settings.setView'
  | 'settings.setAutoSlack'
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
