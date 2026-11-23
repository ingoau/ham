// Owns the account list and every sign-in. An account exists from the moment
// its email is entered; it moves through queued → sending → waiting (for the
// emailed code) → needs2fa → signed-in, with failed/stuck as dead ends. Each
// account has its own session partition, and the in-progress attempt is
// persisted so a restart within the 15-minute window picks it up again.
import { randomUUID } from 'node:crypto'
import { TAG_COLORS, type Account, type AccountGroup, type AccountTag, type CodeResult, type PendingInfo, type ProfileInput, type RefreshResult, type SaveResult, type SlackInfo, type TagColor } from '@shared/types'
import type { AuthBackend, BackendFactory, StartOutcome, VerifyOutcome } from './auth/backend'
import { isValidEmail } from './auth/flow'
import { CHECK_LIMIT, LOGIN_LIMIT, LOGIN_PER_EMAIL_LIMIT, SlidingWindow } from './limits'
import type { Store, StoredAccount } from './store'

/** LoginAttempt::EXPIRATION in hackclub/auth. */
export const ATTEMPT_MS = 15 * 60 * 1000
const REFRESH_INTERVAL = 5 * 60 * 1000
const AUTO_SUBMIT_DELAY = 700

export interface InboxHooks {
  readonly connected: boolean
  expect(accountId: string, email: string, since: number): void
  forget(accountId: string): void
  markUsed(key: string): void
}

type Toast = (text: string, kind: 'success' | 'error' | 'info') => void

const freshPending = (): PendingInfo => ({
  startedAt: null,
  startsAt: null,
  autoCode: null,
  second: 'totp',
  message: null,
  expired: false
})

const noSlack = (): SlackInfo => ({ linked: null, session: false, profile: {} })

function mmss(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export class AccountService {
  private readonly backends = new Map<string, AuthBackend>()
  private readonly busy = new Set<string>()
  private readonly perEmail = new Map<string, SlidingWindow>()
  private readonly loginLimit: SlidingWindow
  private readonly checkLimit: SlidingWindow
  private inbox: InboxHooks | null = null
  private timer: NodeJS.Timeout | null = null
  private lastRefreshAll = 0
  private ticking = false

  constructor(
    private readonly store: Store,
    private readonly makeBackend: BackendFactory,
    private readonly onChange: () => void,
    private readonly toast: Toast
  ) {
    this.loginLimit = new SlidingWindow(LOGIN_LIMIT, undefined, store.loginLog)
    this.checkLimit = new SlidingWindow(CHECK_LIMIT, undefined, store.checkLog)
  }

  setInbox(inbox: InboxHooks) {
    this.inbox = inbox
  }

  list(): Account[] {
    return this.store.accounts.map(toPublic)
  }

  partitionOf(accountId: string): string | null {
    return this.store.find(accountId)?.partition ?? null
  }

  backendFor(accountId: string): AuthBackend | null {
    const a = this.store.find(accountId)
    return a ? this.backend(a.partition) : null
  }

  private backend(partition: string): AuthBackend {
    let b = this.backends.get(partition)
    if (!b) {
      b = this.makeBackend(partition)
      this.backends.set(partition, b)
    }
    return b
  }

  private update(id: string, patch: Partial<StoredAccount>): StoredAccount | null {
    const a = this.store.find(id)
    if (!a) return null
    const next = { ...a, ...patch }
    this.store.upsert(next)
    this.onChange()
    return next
  }

  private patchPending(id: string, patch: Partial<PendingInfo>) {
    const a = this.store.find(id)
    if (!a) return
    this.update(id, { pending: { ...(a.pending ?? freshPending()), ...patch } })
  }

  private saveLogs() {
    this.store.saveLogs(this.loginLimit.entries(), this.checkLimit.entries())
  }

  // --- lifecycle -----------------------------------------------------------

  /** Pick up pending sign-ins after a restart, then start the queue. */
  async resume() {
    const now = Date.now()
    for (const a of this.store.accounts) {
      if (a.status === 'sending') {
        this.update(a.id, { status: 'queued', pending: { ...freshPending() } })
        continue
      }
      if (a.status !== 'waiting' && a.status !== 'needs2fa') continue
      const started = a.pending?.startedAt ? Date.parse(a.pending.startedAt) : 0
      const live = a.attemptPath && now - started < ATTEMPT_MS && (await this.backend(a.partition).resumeAttempt(a.attemptPath))
      if (!live) this.patchPending(a.id, { expired: true, autoCode: null })
      else if (a.status === 'waiting') this.inbox?.connected && this.inbox.expect(a.id, a.email, started)
    }
    this.timer = setInterval(() => void this.tick(), 1000)
    void this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  /** Start queued sign-ins as rate limits allow, and handle expired attempts. */
  private async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      const now = Date.now()
      const inboxOn = this.inbox?.connected === true

      for (const a of this.store.accounts) {
        if ((a.status !== 'waiting' && a.status !== 'needs2fa') || this.busy.has(a.id)) continue
        const started = a.pending?.startedAt ? Date.parse(a.pending.startedAt) : now
        const expired = a.pending?.expired || now - started >= ATTEMPT_MS
        if (!expired) continue
        if (inboxOn) {
          // Start a fresh attempt; the inbox fills the email code, so the user
          // only ever types the authenticator code.
          this.update(a.id, { status: 'queued', attemptPath: null, pending: { ...freshPending(), second: a.pending?.second ?? 'totp' } })
        } else if (!a.pending?.expired) {
          this.patchPending(a.id, { expired: true, autoCode: null })
        }
      }

      const queued = this.store.accounts
        .filter((a) => a.status === 'queued' && !this.busy.has(a.id))
        .sort((x, y) => x.addedAt.localeCompare(y.addedAt))
      let waitingIndex = 0
      for (const a of queued) {
        const emailWindow = this.emailWindow(a.email)
        if (this.loginLimit.available(now) > 0 && emailWindow.available(now) > 0) {
          void this.begin(a.id)
          continue
        }
        const at = Math.max(this.loginLimit.freeAt(waitingIndex++, now), emailWindow.freeAt(0, now))
        const startsAt = new Date(at).toISOString()
        if (a.pending?.startsAt !== startsAt) this.patchPending(a.id, { startsAt })
      }
    } finally {
      this.ticking = false
    }
  }

  private emailWindow(email: string): SlidingWindow {
    let w = this.perEmail.get(email)
    if (!w) {
      w = new SlidingWindow(LOGIN_PER_EMAIL_LIMIT)
      this.perEmail.set(email, w)
    }
    return w
  }

  // --- adding --------------------------------------------------------------

  add(emails: string[]): { added: string[]; existing: string[] } {
    const added: string[] = []
    const existing: string[] = []
    const seen = new Set<string>()
    const now = Date.now()
    emails.forEach((raw, i) => {
      const email = raw.trim().toLowerCase()
      if (!isValidEmail(email) || seen.has(email)) return
      seen.add(email)
      const have = this.store.findByEmail(email)
      if (have) {
        existing.push(have.id)
        return
      }
      const id = randomUUID()
      this.store.upsert({
        id,
        email,
        localName: '',
        firstName: '',
        lastName: '',
        phone: '',
        hasLegalName: false,
        status: 'queued',
        fresh: true,
        pinned: false,
        groupId: null,
        tagIds: [],
        expiresAt: null,
        // Keep the given order for accounts added together.
        addedAt: new Date(now + i).toISOString(),
        pending: freshPending(),
        slack: noSlack(),
        partition: `persist:acct-${randomUUID()}`,
        attemptPath: null
      })
      added.push(id)
    })
    if (added.length) this.onChange()
    void this.tick()
    return { added, existing }
  }

  /** Start (or restart) a sign-in in the account's own partition. */
  restart(id: string) {
    const a = this.store.find(id)
    if (!a || this.busy.has(id) || a.status === 'signed-in') return
    this.inbox?.forget(id)
    this.update(id, { status: 'queued', attemptPath: null, pending: freshPending() })
    void this.tick()
  }

  signInAgain(ids: string[]) {
    for (const id of ids) {
      const a = this.store.find(id)
      if (a && a.status === 'signed-out') this.restart(id)
    }
  }

  private async begin(id: string) {
    const a = this.store.find(id)
    if (!a || a.status !== 'queued' || this.busy.has(id)) return
    if (!this.loginLimit.take() || !this.emailWindow(a.email).take()) return
    this.saveLogs()
    this.busy.add(id)
    try {
      const backend = this.backend(a.partition)
      // A clean cookie jar, so an expired session or old attempt can't interfere.
      await backend.clearLocalData()
      this.update(id, { status: 'sending', pending: { ...freshPending(), second: a.pending?.second ?? 'totp' } })
      const outcome = await backend.startLogin(a.email)
      this.afterStart(id, outcome, backend)
    } finally {
      this.busy.delete(id)
    }
  }

  private afterStart(id: string, outcome: StartOutcome, backend: AuthBackend) {
    const a = this.store.find(id)
    if (!a || a.status !== 'sending') return // removed meanwhile
    switch (outcome.kind) {
      case 'code': {
        const started = Date.now()
        this.update(id, {
          status: 'waiting',
          attemptPath: backend.attemptPath(),
          pending: { ...(a.pending ?? freshPending()), startedAt: new Date(started).toISOString(), startsAt: null, message: null, expired: false }
        })
        if (this.inbox?.connected) this.inbox.expect(id, a.email, started)
        return
      }
      case 'no-account':
        this.update(id, { status: 'failed', pending: { ...freshPending(), message: 'no-account' } })
        return
      case 'rate-limited':
        // The server's own limit: back off for a full window.
        for (let i = 0; i < LOGIN_LIMIT; i++) this.loginLimit.take()
        this.saveLogs()
        this.update(id, { status: 'queued', pending: { ...freshPending(), message: null } })
        return
      case 'locked':
      case 'unexpected':
        this.update(id, { status: 'failed', pending: { ...freshPending(), message: outcome.message } })
        return
    }
  }

  // --- codes ---------------------------------------------------------------

  /** A code from the linked inbox: show it, then submit it. */
  onInboxCode(id: string, code: string, key: string) {
    const a = this.store.find(id)
    if (!a || a.status !== 'waiting') return
    this.patchPending(id, { autoCode: code, message: null })
    setTimeout(() => {
      const now = this.store.find(id)
      if (!now || now.status !== 'waiting' || now.pending?.autoCode !== code) return
      this.inbox?.markUsed(key)
      void this.submitEmailCode(id, code, true)
    }, AUTO_SUBMIT_DELAY)
  }

  /** The inbox (re)connected: start watching for every waiting account's code. */
  onInboxConnected() {
    for (const a of this.store.accounts) {
      if (a.status !== 'waiting' || !a.pending?.startedAt) continue
      if (a.pending.expired) this.restart(a.id)
      else this.inbox?.expect(a.id, a.email, Date.parse(a.pending.startedAt))
    }
    void this.tick()
  }

  private takeCheck(): string | null {
    if (this.checkLimit.take()) {
      this.saveLogs()
      return null
    }
    return `Too many code checks. Try again in ${mmss(this.checkLimit.freeAt(0) - Date.now())}.`
  }

  async submitEmailCode(id: string, code: string, auto = false): Promise<CodeResult> {
    const a = this.store.find(id)
    if (!a || a.status !== 'waiting') return { ok: false, message: 'This sign-in has moved on. Check the account.' }
    if (this.busy.has(id)) return { ok: false, message: 'Already checking a code.' }
    const limited = this.takeCheck()
    if (limited) {
      if (auto) setTimeout(() => void this.submitEmailCode(id, code, true), 15_000)
      return { ok: false, message: limited }
    }
    this.busy.add(id)
    try {
      const outcome = await this.backend(a.partition).verifyEmailCode(code)
      return await this.afterVerify(id, outcome, auto)
    } finally {
      this.busy.delete(id)
    }
  }

  async submitSecondFactor(id: string, kind: 'totp' | 'backup', code: string): Promise<CodeResult> {
    const a = this.store.find(id)
    if (!a || a.status !== 'needs2fa') return { ok: false, message: 'This sign-in has moved on. Check the account.' }
    if (this.busy.has(id)) return { ok: false, message: 'Already checking a code.' }
    const limited = this.takeCheck()
    if (limited) return { ok: false, message: limited }
    this.busy.add(id)
    try {
      this.patchPending(id, { second: kind })
      const outcome = await this.backend(a.partition).verifySecondFactor(kind, code)
      return await this.afterVerify(id, outcome, false)
    } finally {
      this.busy.delete(id)
    }
  }

  private async afterVerify(id: string, outcome: VerifyOutcome, auto: boolean): Promise<CodeResult> {
    switch (outcome.kind) {
      case 'done':
        await this.finish(id)
        return { ok: true }
      case 'totp':
      case 'backup':
        this.update(id, { status: 'needs2fa' })
        this.patchPending(id, { second: outcome.kind, autoCode: null, message: null })
        return { ok: true }
      case 'passkey-only':
        this.update(id, { status: 'stuck', attemptPath: null })
        this.patchPending(id, { autoCode: null })
        return { ok: true }
      case 'invalid':
        if (auto) {
          // Probably a code from an older attempt: keep watching for the right one.
          const a = this.store.find(id)
          this.patchPending(id, { autoCode: null, message: 'The code from your inbox didn’t work. Waiting for a newer one.' })
          if (a?.pending?.startedAt) this.inbox?.expect(id, a.email, Date.parse(a.pending.startedAt))
        }
        return { ok: false, message: outcome.message }
      case 'rate-limited':
        return { ok: false, message: 'Too many attempts. Wait a few minutes, then try again.' }
      case 'unexpected':
        if (/expired/i.test(outcome.message)) this.patchPending(id, { expired: true, autoCode: null })
        return { ok: false, message: outcome.message }
    }
  }

  private async finish(id: string) {
    const a = this.store.find(id)
    if (!a) return
    const backend = this.backend(a.partition)
    const read = await backend.readProfile()
    if (read.kind !== 'ok') {
      this.update(id, { status: 'failed', attemptPath: null, pending: { ...freshPending(), message: "Signed in, but HAM couldn't read the account details." } })
      return
    }
    const slack = await this.slackInfo(backend, a.slack)
    this.inbox?.forget(id)
    this.update(id, {
      ...read.profile,
      status: 'signed-in',
      fresh: false,
      expiresAt: await backend.sessionExpiry(),
      pending: null,
      attemptPath: null,
      slack
    })
    this.toast(a.fresh ? `Added ${a.email}` : `Signed in again: ${a.email}`, 'success')
  }

  // --- removing ------------------------------------------------------------

  /**
   * Remove an account. Signed-in accounts are signed out on the server first.
   * A pending sign-in of an existing account is cancelled back to signed out.
   */
  async remove(id: string): Promise<{ serverSignedOut: boolean; removed: boolean }> {
    const a = this.store.find(id)
    if (!a) return { serverSignedOut: false, removed: false }
    this.inbox?.forget(id)
    const backend = this.backend(a.partition)
    if (a.status !== 'signed-in' && a.status !== 'signed-out' && !a.fresh) {
      await backend.clearLocalData()
      this.update(id, { status: 'signed-out', pending: null, attemptPath: null })
      return { serverSignedOut: true, removed: false }
    }
    const serverSignedOut = a.status === 'signed-in' ? await backend.signOut() : true
    await backend.clearLocalData()
    this.backends.delete(a.partition)
    this.store.remove(id)
    this.onChange()
    return { serverSignedOut, removed: true }
  }

  // --- profiles ------------------------------------------------------------

  async refresh(id: string): Promise<RefreshResult> {
    const a = this.store.find(id)
    if (!a) return { ok: false, reason: 'unexpected', message: 'Account not found.' }
    if (a.status !== 'signed-in') return { ok: false, reason: 'signed-out' }
    const backend = this.backend(a.partition)
    const read = await backend.readProfile()
    if (read.kind === 'signed-out') {
      this.update(id, { status: 'signed-out' })
      return { ok: false, reason: 'signed-out' }
    }
    if (read.kind === 'unexpected') return { ok: false, reason: 'network', message: read.message }
    const next = this.update(id, {
      ...read.profile,
      expiresAt: (await backend.sessionExpiry()) ?? a.expiresAt,
      slack: await this.slackInfo(backend, a.slack)
    })!
    return { ok: true, account: toPublic(next) }
  }

  /** Refresh every signed-in account, at most every five minutes unless forced. */
  async refreshAll(force = false): Promise<void> {
    if (!force && Date.now() - this.lastRefreshAll < REFRESH_INTERVAL) return
    this.lastRefreshAll = Date.now()
    this.markExpired()
    const signedIn = this.store.accounts.filter((a) => a.status === 'signed-in')
    await Promise.allSettled(signedIn.map((a) => this.refresh(a.id)))
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
    const result = await this.backend(a.partition).saveProfile(input)
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

  /** Slack status from HCA's /slack-id plus the partition's Slack cookie. */
  private async slackInfo(backend: AuthBackend, prev: SlackInfo): Promise<SlackInfo> {
    const [session, slackId] = await Promise.all([backend.hasSlackSession(), backend.slackId()])
    if (slackId === undefined) return { ...prev, session, linked: session ? true : prev.linked }
    return { ...prev, session, linked: slackId !== null || session, id: slackId ?? undefined }
  }

  /** A name only HAM shows. Empty clears it. */
  setLocalName(id: string, name: string) {
    const a = this.store.find(id)
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!a || a.localName === clean) return
    this.store.upsert({ ...a, localName: clean })
    this.onChange()
  }

  setPinned(ids: string[], pinned: boolean) {
    for (const id of ids) {
      const a = this.store.find(id)
      if (a && a.pinned !== pinned) this.store.upsert({ ...a, pinned })
    }
    this.onChange()
  }

  reorder(ids: string[]) {
    this.store.reorder(ids)
    this.onChange()
  }

  get groups(): AccountGroup[] {
    return this.store.groups
  }

  /** Move accounts into a group (or out, with null). Moving also unpins, so they show up there. */
  setGroup(ids: string[], groupId: string | null) {
    if (groupId !== null && !this.store.groups.some((g) => g.id === groupId)) return
    for (const id of ids) {
      const a = this.store.find(id)
      if (a && (a.groupId !== groupId || a.pinned)) this.store.upsert({ ...a, groupId, pinned: false })
    }
    this.onChange()
  }

  createGroup(name: string, ids: string[]): string | null {
    const clean = name.trim().slice(0, 60)
    if (!clean) return null
    const id = randomUUID()
    this.store.groups = [...this.store.groups, { id, name: clean }]
    if (ids.length) this.setGroup(ids, id)
    else this.onChange()
    return id
  }

  renameGroup(id: string, name: string) {
    const clean = name.trim().slice(0, 60)
    if (!clean) return
    this.store.groups = this.store.groups.map((g) => (g.id === id ? { ...g, name: clean } : g))
    this.onChange()
  }

  deleteGroup(id: string) {
    this.store.groups = this.store.groups.filter((g) => g.id !== id)
    this.onChange()
  }

  reorderGroups(ids: string[]) {
    const byId = new Map(this.store.groups.map((g) => [g.id, g]))
    const listed = ids.map((id) => byId.get(id)).filter((g): g is AccountGroup => !!g)
    this.store.groups = [...listed, ...this.store.groups.filter((g) => !ids.includes(g.id))]
    this.onChange()
  }

  get tags(): AccountTag[] {
    return this.store.tags
  }

  /** Add a tag to accounts, or take it off them. */
  setTag(ids: string[], tagId: string, on: boolean) {
    if (!this.store.tags.some((t) => t.id === tagId)) return
    for (const id of ids) {
      const a = this.store.find(id)
      if (!a || a.tagIds.includes(tagId) === on) continue
      this.store.upsert({ ...a, tagIds: on ? [...a.tagIds, tagId] : a.tagIds.filter((t) => t !== tagId) })
    }
    this.onChange()
  }

  createTag(name: string, color: TagColor, ids: string[]): string | null {
    const clean = name.trim().slice(0, 40)
    if (!clean) return null
    const id = randomUUID()
    this.store.tags = [...this.store.tags, { id, name: clean, color: TAG_COLORS.includes(color) ? color : 'gray' }]
    if (ids.length) this.setTag(ids, id, true)
    else this.onChange()
    return id
  }

  updateTag(id: string, patch: { name?: string; color?: TagColor }) {
    const name = patch.name?.trim().slice(0, 40)
    const color = patch.color && TAG_COLORS.includes(patch.color) ? patch.color : undefined
    this.store.tags = this.store.tags.map((t) => (t.id === id ? { ...t, ...(name ? { name } : {}), ...(color ? { color } : {}) } : t))
    this.onChange()
  }

  deleteTag(id: string) {
    this.store.tags = this.store.tags.filter((t) => t.id !== id)
    this.onChange()
  }

  reorderTags(ids: string[]) {
    const byId = new Map(this.store.tags.map((t) => [t.id, t]))
    const listed = ids.map((id) => byId.get(id)).filter((t): t is AccountTag => !!t)
    this.store.tags = [...listed, ...this.store.tags.filter((t) => !ids.includes(t.id))]
    this.onChange()
  }

  setSlack(id: string, patch: Partial<SlackInfo>) {
    const a = this.store.find(id)
    if (a) this.update(id, { slack: { ...a.slack, ...patch } })
  }

  markSignedOut(id: string) {
    const a = this.store.find(id)
    if (a && a.status === 'signed-in') this.update(id, { status: 'signed-out' })
  }
}

function toPublic(a: StoredAccount): Account {
  const { partition, attemptPath, ...rest } = a
  void partition // never sent to the renderer
  void attemptPath
  return rest
}
