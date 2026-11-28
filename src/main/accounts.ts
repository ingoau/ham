// Owns the account list. Each account has its own session partition. Sign-ins
// run through the queue (signin-queue.ts), Slack sign-ins through
// slack-sessions.ts, and groups, tags and pins through organizer.ts; this
// service ties them together and reads and saves profiles.
import type { Account, AccountGroup, AccountTag, CodeResult, ProfileInput, RefreshResult, SaveResult, SlackFieldDef, SlackInfo, SlackProfile, SlackSaveResult, SlackSignInResult, TagColor } from '@shared/types'
import type { ImportPlan } from './account-export'
import type { AuthBackend, BackendFactory, SlackOutcome } from './auth/backend'
import { AccountRecords, noSlack, toPublic, type Toast } from './account-records'
import { Organizer } from './organizer'
import { SignInQueue, type InboxHooks } from './signin-queue'
import { SlackSessions, type SlackSignIn } from './slack-sessions'
import { STANDARD_KEYS } from './slack-profile'
import type { Store, StoredAccount } from './store'

export { ATTEMPT_MS, type InboxHooks } from './signin-queue'
export type { SlackSignIn } from './slack-sessions'

const REFRESH_INTERVAL = 5 * 60 * 1000

export class AccountService {
  private readonly records: AccountRecords
  private readonly queue: SignInQueue
  private readonly slack: SlackSessions
  private readonly organizer: Organizer
  private lastRefreshAll = 0

  constructor(
    private readonly store: Store,
    makeBackend: BackendFactory,
    onChange: () => void,
    toast: Toast
  ) {
    this.records = new AccountRecords(store, makeBackend, onChange)
    this.slack = new SlackSessions(this.records, (id, fresh) => this.refreshSlack(id, fresh))
    this.queue = new SignInQueue(
      this.records,
      {
        slackStatus: (id, backend) => this.slackStatus(id, backend),
        signedIn: (id) => {
          // Slack can be slow or rate limited: don't hold up the sign-in for it.
          void this.refreshSlack(id)
          this.slack.autoSignIn([id])
        }
      },
      toast
    )
    this.organizer = new Organizer(store, onChange)
  }

  setInbox(inbox: InboxHooks) {
    this.queue.setInbox(inbox)
  }

  setSlackSignIn(fn: SlackSignIn) {
    this.slack.setSignIn(fn)
  }

  list(): Account[] {
    return this.store.accounts.map(toPublic)
  }

  partitionOf(accountId: string): string | null {
    return this.store.find(accountId)?.partition ?? null
  }

  backendFor(accountId: string): AuthBackend | null {
    const a = this.store.find(accountId)
    return a ? this.records.backend(a.partition) : null
  }

  private update(id: string, patch: Partial<StoredAccount>): StoredAccount | null {
    return this.records.update(id, patch)
  }

  // --- sign-in (see signin-queue.ts) ---------------------------------------

  /** Pick up pending sign-ins after a restart, then start the queue. */
  resume(): Promise<void> {
    return this.queue.resume()
  }

  stop() {
    this.queue.stop()
  }

  add(emails: string[]): { added: string[]; existing: string[] } {
    return this.queue.add(emails)
  }

  /** Start (or restart) a sign-in in the account's own partition. */
  restart(id: string) {
    this.queue.restart(id)
  }

  signInAgain(ids: string[]) {
    this.queue.signInAgain(ids)
  }

  onInboxCode(id: string, code: string, key: string) {
    this.queue.onInboxCode(id, code, key)
  }

  onInboxConnected() {
    this.queue.onInboxConnected()
  }

  submitEmailCode(id: string, code: string, auto = false): Promise<CodeResult> {
    return this.queue.submitEmailCode(id, code, auto)
  }

  submitSecondFactor(id: string, kind: 'totp' | 'backup', code: string): Promise<CodeResult> {
    return this.queue.submitSecondFactor(id, kind, code)
  }

  // --- removing ------------------------------------------------------------

  /**
   * Remove an account. Signed-in accounts are signed out on the server first.
   * A pending sign-in of an existing account is cancelled back to signed out.
   */
  async remove(id: string): Promise<{ serverSignedOut: boolean; removed: boolean }> {
    const a = this.store.find(id)
    if (!a) return { serverSignedOut: false, removed: false }
    this.queue.forget(id)
    this.slack.forget(id)
    const backend = this.records.backend(a.partition)
    if (a.status !== 'signed-in' && a.status !== 'signed-out' && !a.fresh) {
      await backend.clearLocalData()
      this.update(id, { status: 'signed-out', pending: null, attemptPath: null })
      return { serverSignedOut: true, removed: false }
    }
    const serverSignedOut = a.status === 'signed-in' ? await backend.signOut() : true
    await backend.clearLocalData()
    this.records.dropBackend(a.partition)
    this.store.remove(id)
    this.records.onChange()
    return { serverSignedOut, removed: true }
  }

  // --- profiles ------------------------------------------------------------

  async refresh(id: string): Promise<RefreshResult> {
    const a = this.store.find(id)
    if (!a) return { ok: false, reason: 'unexpected', message: 'Account not found.' }
    if (a.status !== 'signed-in') {
      // Slack's session outlives Hack Club's: its profile can still be read.
      if (a.slack.session) await this.refreshSlack(id)
      return { ok: false, reason: 'signed-out' }
    }
    const backend = this.records.backend(a.partition)
    const read = await backend.readProfile()
    if (read.kind === 'signed-out') {
      this.update(id, { status: 'signed-out' })
      return { ok: false, reason: 'signed-out' }
    }
    if (read.kind === 'unexpected') return { ok: false, reason: 'network', message: read.message }
    const expiresAt = (await backend.sessionExpiry()) ?? a.expiresAt
    const slack = await this.slackStatus(id, backend)
    this.update(id, { ...read.profile, expiresAt, slack })
    await this.refreshSlack(id)
    this.slack.autoSignIn([id])
    const next = this.store.find(id)
    return next ? { ok: true, account: toPublic(next) } : { ok: false, reason: 'unexpected', message: 'Account not found.' }
  }

  /** Refresh every signed-in account, at most every five minutes unless forced. */
  async refreshAll(force = false): Promise<void> {
    if (!force && Date.now() - this.lastRefreshAll < REFRESH_INTERVAL) return
    this.lastRefreshAll = Date.now()
    this.markExpired()
    const signedIn = this.store.accounts.filter((a) => a.status === 'signed-in')
    // A Slack session outlives the Hack Club one, so signed-out accounts can still read Slack.
    const slackOnly = this.store.accounts.filter((a) => a.status === 'signed-out' && a.slack.session)
    await Promise.allSettled([...signedIn.map((a) => this.refresh(a.id)), ...slackOnly.map((a) => this.refreshSlack(a.id))])
  }

  /** Mark accounts whose session cookie has passed its expiry as signed out. */
  markExpired() {
    const now = Date.now()
    for (const a of this.store.accounts) {
      if (a.status === 'signed-in' && a.expiresAt && Date.parse(a.expiresAt) < now) this.update(a.id, { status: 'signed-out' })
    }
  }

  async save(id: string, input: ProfileInput): Promise<SaveResult> {
    const a = this.store.find(id)
    if (!a) return { ok: false, reason: 'unexpected', message: 'Account not found.' }
    if (a.status !== 'signed-in') return { ok: false, reason: 'signed-out' }
    const messages: string[] = []
    if (!input.firstName.trim()) messages.push("First name can't be blank")
    if (!input.lastName.trim()) messages.push("Last name can't be blank")
    if (messages.length) return { ok: false, reason: 'validation', messages }
    const result = await this.records.backend(a.partition).saveProfile(input)
    switch (result.kind) {
      case 'ok':
        return { ok: true, account: toPublic(this.update(id, { ...result.profile })!) }
      case 'validation':
        return { ok: false, reason: 'validation', messages: result.messages }
      case 'signed-out':
        this.update(id, { status: 'signed-out' })
        return { ok: false, reason: 'signed-out' }
      case 'unexpected':
        return { ok: false, reason: 'unexpected', message: result.message }
    }
  }

  /**
   * Whether the account is on Slack (HCA's /slack-id) and has a Slack cookie,
   * applied to its latest Slack info.
   */
  private async slackStatus(id: string, backend: AuthBackend): Promise<SlackInfo> {
    const [cookie, slackId] = await Promise.all([backend.hasSlackSession(), backend.slackId()])
    const prev = this.store.find(id)?.slack ?? noSlack()
    if (slackId === undefined) return { ...prev, session: cookie, linked: cookie ? true : prev.linked }
    return { ...prev, session: cookie, linked: slackId !== null || cookie, id: slackId ?? prev.id }
  }

  /** Fold a Slack read into the account's latest Slack info (and the app's field list). */
  private applySlackRead(id: string, read: SlackOutcome): StoredAccount | null {
    const a = this.store.find(id)
    if (!a) return null
    if (read.kind === 'signed-out') return this.update(id, { slack: { ...a.slack, session: false } })
    if (read.kind !== 'ok') return a
    this.setSlackFields(read.fields)
    const slack: SlackInfo = { ...a.slack, linked: true, session: true, id: read.userId, profile: read.profile, users: read.users, fetchedAt: new Date().toISOString() }
    return this.update(id, { slack })
  }

  private setSlackFields(fields: SlackFieldDef[]) {
    if (JSON.stringify(fields) !== JSON.stringify(this.store.slackFields)) this.store.slackFields = fields
  }

  /**
   * Read the Slack profile again. `fresh` drops the cached token first: after
   * Launch Slack, the session may belong to a different sign-in.
   */
  refreshSlack(id: string, fresh = false): Promise<void> {
    return this.records.slackLocked(id, async () => {
      const a = this.store.find(id)
      if (!a) return
      const backend = this.records.backend(a.partition)
      if (!(await backend.hasSlackSession())) {
        if (a.slack.session) this.setSlack(id, { session: false })
        return
      }
      this.applySlackRead(id, await backend.readSlack(fresh))
    })
  }

  /** A reason these changes can't be saved, or null. */
  private slackChangeProblem(a: StoredAccount, changes: SlackProfile): string | null {
    const fields = new Map(this.store.slackFields.map((f) => [f.id, f]))
    for (const key of Object.keys(changes)) {
      if ((STANDARD_KEYS as readonly string[]).includes(key) || ['tz', 'title', 'status_expiration'].includes(key)) continue
      const f = fields.get(key.split('.')[0])
      if (!f || !f.editable || (f.kind === 'link') !== key.includes('.')) return 'That Slack field can’t be changed here.'
    }
    if ('real_name' in changes && !changes.real_name.trim()) return "Full name can't be blank."
    for (const f of fields.values()) {
      if (f.kind !== 'link' || !(`${f.id}.text` in changes || `${f.id}.url` in changes)) continue
      const value = (part: string) => (changes[`${f.id}.${part}`] ?? a.slack.profile[`${f.id}.${part}`] ?? '').trim()
      if (value('text') && !value('url')) return `${f.label}: add a URL for the display text.`
    }
    return null
  }

  saveSlack(id: string, changes: SlackProfile): Promise<SlackSaveResult> {
    return this.records.slackLocked(id, async (): Promise<SlackSaveResult> => {
      const a = this.store.find(id)
      if (!a) return { ok: false, reason: 'rejected', message: 'Account not found.' }
      if (!a.slack.session) return { ok: false, reason: 'slack-signed-out' }
      const problem = this.slackChangeProblem(a, changes)
      if (problem) return { ok: false, reason: 'rejected', message: problem }
      if (Object.keys(changes).length === 0) return { ok: true, account: toPublic(a) }
      const result = await this.records.backend(a.partition).saveSlack(changes)
      const next = this.applySlackRead(id, result)
      if (!next) return { ok: false, reason: 'rejected', message: 'Account not found.' }
      switch (result.kind) {
        case 'ok':
          return { ok: true, account: toPublic(next) }
        case 'signed-out':
          return { ok: false, reason: 'slack-signed-out' }
        default:
          // Part of the save may have landed before the failure: read back what Slack has now.
          queueMicrotask(() => void this.refreshSlack(id))
          return { ok: false, reason: result.kind, message: result.message }
      }
    })
  }

  setSlack(id: string, patch: Partial<SlackInfo>) {
    this.records.setSlack(id, patch)
  }

  markSignedOut(id: string) {
    this.records.markSignedOut(id)
  }

  // --- organizing (see organizer.ts) ---------------------------------------

  setLocalName(id: string, name: string) {
    this.organizer.setLocalName(id, name)
  }

  setPinned(ids: string[], pinned: boolean) {
    this.organizer.setPinned(ids, pinned)
  }

  reorder(ids: string[]) {
    this.organizer.reorder(ids)
  }

  get groups(): AccountGroup[] {
    return this.organizer.groups
  }

  setGroup(ids: string[], groupId: string | null) {
    this.organizer.setGroup(ids, groupId)
  }

  createGroup(name: string, ids: string[]): string | null {
    return this.organizer.createGroup(name, ids)
  }

  renameGroup(id: string, name: string) {
    this.organizer.renameGroup(id, name)
  }

  deleteGroup(id: string) {
    this.organizer.deleteGroup(id)
  }

  reorderGroups(ids: string[]) {
    this.organizer.reorderGroups(ids)
  }

  get tags(): AccountTag[] {
    return this.organizer.tags
  }

  setTag(ids: string[], tagId: string, on: boolean) {
    this.organizer.setTag(ids, tagId, on)
  }

  createTag(name: string, color: TagColor, ids: string[]): string | null {
    return this.organizer.createTag(name, color, ids)
  }

  updateTag(id: string, patch: { name?: string; color?: TagColor }) {
    this.organizer.updateTag(id, patch)
  }

  deleteTag(id: string) {
    this.organizer.deleteTag(id)
  }

  reorderTags(ids: string[]) {
    this.organizer.reorderTags(ids)
  }

  /** Add an import's new accounts (they sign in through the queue, like pasted emails) and organise them as the file says. */
  importAccounts(plan: ImportPlan): number {
    const { added } = this.queue.add(plan.fresh.map((a) => a.email))
    const ids = new Set(added)
    const entries = plan.fresh.flatMap((e) => {
      const a = this.store.findByEmail(e.email)
      return a && ids.has(a.id) ? [{ ...e, id: a.id }] : []
    })
    this.organizer.applyImport(entries, plan.newGroups, plan.newTags)
    return added.length
  }

  // --- Slack sign-in and sign-out (see slack-sessions.ts) ------------------

  signInSlack(id: string): Promise<SlackSignInResult> {
    return this.slack.signIn(id)
  }

  cancelSlackSignIns() {
    this.slack.cancelAll()
  }

  autoSignInSlack(ids?: string[]) {
    this.slack.autoSignIn(ids)
  }

  setAutoSlack(on: boolean) {
    this.slack.setAuto(on)
  }

  signOutSlack(id: string): Promise<void> {
    return this.slack.signOut(id)
  }
}
