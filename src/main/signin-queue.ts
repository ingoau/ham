// Every Hack Club sign-in. An account exists from the moment its email is
// entered; it moves through queued → sending → waiting (for the emailed code)
// → needs2fa → signed-in, with failed/stuck as dead ends. The in-progress
// attempt is persisted so a restart within the 15-minute window picks it up
// again. Sign-ins start as the client-side rate limits allow.
import { randomUUID } from 'node:crypto'
import type { CodeResult, SlackInfo } from '@shared/types'
import type { AuthBackend, StartOutcome, VerifyOutcome } from './auth/backend'
import { isValidEmail } from './auth/flow'
import { freshPending, noSlack, type AccountRecords, type Toast } from './account-records'
import { CHECK_LIMIT, LOGIN_LIMIT, LOGIN_PER_EMAIL_LIMIT, SlidingWindow } from './limits'
import type { StoredAccount } from './store'

/** LoginAttempt::EXPIRATION in hackclub/auth. */
export const ATTEMPT_MS = 15 * 60 * 1000
const AUTO_SUBMIT_DELAY = 700
/** How long an inbox code waits before it's submitted again (rate limited, or no connection). */
const AUTO_RETRY = 15_000
/** Waits before starting a sign-in again after a network error, growing with each one in a row. */
export const NETWORK_RETRY = [5_000, 15_000, 60_000]
/** Retries in a row after a request that may have reached Hack Club (each one may send a code email). */
export const SENT_RETRY_LIMIT = 2

export interface InboxHooks {
  readonly connected: boolean
  expect(accountId: string, email: string, since: number): void
  forget(accountId: string): void
  markUsed(key: string): void
}

export interface SignInHooks {
  /** The Slack info to store for an account that has just signed in. */
  slackStatus(id: string, backend: AuthBackend): Promise<SlackInfo>
  /** A sign-in completed. */
  signedIn(id: string): void
}

function mmss(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export class SignInQueue {
  private readonly busy = new Set<string>()
  private readonly perEmail = new Map<string, SlidingWindow>()
  private readonly loginLimit: SlidingWindow
  private readonly checkLimit: SlidingWindow
  /** Network errors in a row (`sent`: those that may have reached Hack Club), and when to try again. */
  private readonly retries = new Map<string, { count: number; sent: number; at: number }>()
  private inbox: InboxHooks | null = null
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  constructor(
    private readonly records: AccountRecords,
    private readonly hooks: SignInHooks,
    private readonly toast: Toast
  ) {
    this.loginLimit = new SlidingWindow(LOGIN_LIMIT, undefined, records.store.loginLog)
    this.checkLimit = new SlidingWindow(CHECK_LIMIT, undefined, records.store.checkLog)
  }

  private get store() {
    return this.records.store
  }

  private update(id: string, patch: Partial<StoredAccount>) {
    return this.records.update(id, patch)
  }

  setInbox(inbox: InboxHooks) {
    this.inbox = inbox
  }

  /** Drop what the queue keeps for an account that's being removed or cancelled. */
  forget(id: string) {
    this.inbox?.forget(id)
    this.retries.delete(id)
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
      const live = a.attemptPath && now - started < ATTEMPT_MS && (await this.records.backend(a.partition).resumeAttempt(a.attemptPath))
      if (!live) this.records.patchPending(a.id, { expired: true, autoCode: null })
      else if (a.status === 'waiting') this.inbox?.connected && this.inbox.expect(a.id, a.email, started)
    }
    this.timer = setInterval(() => void this.tick(), 1000)
    void this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Start queued sign-ins as rate limits allow, and handle expired attempts. */
  async tick() {
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
          this.records.patchPending(a.id, { expired: true, autoCode: null })
        }
      }

      const queued = this.store.accounts
        .filter((a) => a.status === 'queued' && !this.busy.has(a.id))
        .sort((x, y) => x.addedAt.localeCompare(y.addedAt))
      let waitingIndex = 0
      for (const a of queued) {
        const retryAt = this.retries.get(a.id)?.at ?? 0
        if (retryAt > now) {
          this.showStartsAt(a, retryAt)
          continue
        }
        const emailWindow = this.emailWindow(a.email)
        if (this.loginLimit.available(now) > 0 && emailWindow.available(now) > 0) {
          void this.begin(a.id)
          continue
        }
        this.showStartsAt(a, Math.max(this.loginLimit.freeAt(waitingIndex++, now), emailWindow.freeAt(0, now)))
      }
    } finally {
      this.ticking = false
    }
  }

  private showStartsAt(a: StoredAccount, at: number) {
    const startsAt = new Date(at).toISOString()
    if (a.pending?.startsAt !== startsAt) this.records.patchPending(a.id, { startsAt })
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
    if (added.length) this.records.onChange()
    void this.tick()
    return { added, existing }
  }

  /** Start (or restart) a sign-in in the account's own partition. */
  restart(id: string) {
    const a = this.store.find(id)
    if (!a || this.busy.has(id) || a.status === 'signed-in') return
    this.forget(id)
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
    const at = Date.now()
    const emailWindow = this.emailWindow(a.email)
    if (this.loginLimit.available(at) === 0 || emailWindow.available(at) === 0) return
    this.loginLimit.take(at)
    emailWindow.take(at)
    this.saveLogs()
    this.busy.add(id)
    const second = a.pending?.second ?? 'totp'
    let sent = false
    try {
      const backend = this.records.backend(a.partition)
      // A clean cookie jar, so an expired session or old attempt can't interfere.
      await backend.clearLocalData()
      this.update(id, { status: 'sending', pending: { ...freshPending(), second } })
      sent = true
      const outcome = await backend.startLogin(a.email)
      this.afterStart(id, outcome, backend, at)
    } catch (err) {
      console.error('[signin] start failed', err)
      if (!sent) this.refund(a.email, at)
      this.retries.delete(id)
      const now = this.store.find(id)
      if (now && (now.status === 'queued' || now.status === 'sending')) {
        this.update(id, { status: 'failed', attemptPath: null, pending: { ...freshPending(), second, message: 'Couldn’t start the sign-in.' } })
      }
    } finally {
      this.busy.delete(id)
    }
  }

  /** Give back a login slot taken at `at`: the request never reached Hack Club. */
  private refund(email: string, at: number) {
    this.loginLimit.refund(at)
    this.emailWindow(email).refund(at)
    this.saveLogs()
  }

  private afterStart(id: string, outcome: StartOutcome, backend: AuthBackend, takenAt: number) {
    const a = this.store.find(id)
    if (!a || a.status !== 'sending') return // removed meanwhile
    const second = a.pending?.second ?? 'totp'
    if (outcome.kind !== 'network') this.retries.delete(id)
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
      case 'network': {
        // Offline or a dropped connection: wait, then try again. A request that may have
        // reached Hack Club (a timeout) may have sent a code email, so only retry it a little.
        if (!outcome.sent) this.refund(a.email, takenAt)
        const prev = this.retries.get(id)
        const sentCount = (prev?.sent ?? 0) + (outcome.sent ? 1 : 0)
        if (sentCount > SENT_RETRY_LIMIT) {
          this.retries.delete(id)
          this.update(id, { status: 'failed', pending: { ...freshPending(), second, message: outcome.message } })
          return
        }
        const count = (prev?.count ?? 0) + 1
        const at = Date.now() + NETWORK_RETRY[Math.min(count, NETWORK_RETRY.length) - 1]
        this.retries.set(id, { count, sent: sentCount, at })
        this.update(id, { status: 'queued', pending: { ...freshPending(), second, startsAt: new Date(at).toISOString(), message: outcome.message } })
        return
      }
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
    this.records.patchPending(id, { autoCode: code, message: null })
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

  /** Take a code check slot: its time, or why there's none. */
  private takeCheck(): number | string {
    const at = Date.now()
    if (this.checkLimit.take(at)) {
      this.saveLogs()
      return at
    }
    return `Too many code checks. Try again in ${mmss(this.checkLimit.freeAt(0) - Date.now())}.`
  }

  /** Submit an inbox code again later, unless the sign-in has moved on meanwhile. */
  private retryAuto(id: string, code: string) {
    setTimeout(() => {
      const a = this.store.find(id)
      if (a?.status === 'waiting' && a.pending?.autoCode === code && !a.pending.expired) void this.submitEmailCode(id, code, true)
    }, AUTO_RETRY)
  }

  async submitEmailCode(id: string, code: string, auto = false): Promise<CodeResult> {
    const a = this.store.find(id)
    if (!a || a.status !== 'waiting') return { ok: false, message: 'This sign-in has moved on. Check the account.' }
    if (this.busy.has(id)) return { ok: false, message: 'Already checking a code.' }
    const slot = this.takeCheck()
    if (typeof slot === 'string') {
      if (auto) this.retryAuto(id, code)
      return { ok: false, message: slot }
    }
    this.busy.add(id)
    try {
      const outcome = await this.records.backend(a.partition).verifyEmailCode(code)
      if (outcome.kind === 'network' && auto) this.retryAuto(id, code)
      return await this.afterVerify(id, outcome, auto, slot)
    } finally {
      this.busy.delete(id)
    }
  }

  async submitSecondFactor(id: string, kind: 'totp' | 'backup', code: string): Promise<CodeResult> {
    const a = this.store.find(id)
    if (!a || a.status !== 'needs2fa') return { ok: false, message: 'This sign-in has moved on. Check the account.' }
    if (this.busy.has(id)) return { ok: false, message: 'Already checking a code.' }
    const slot = this.takeCheck()
    if (typeof slot === 'string') return { ok: false, message: slot }
    this.busy.add(id)
    try {
      this.records.patchPending(id, { second: kind })
      const outcome = await this.records.backend(a.partition).verifySecondFactor(kind, code)
      return await this.afterVerify(id, outcome, false, slot)
    } finally {
      this.busy.delete(id)
    }
  }

  private async afterVerify(id: string, outcome: VerifyOutcome, auto: boolean, takenAt: number): Promise<CodeResult> {
    switch (outcome.kind) {
      case 'done':
        await this.finish(id)
        return { ok: true }
      case 'totp':
      case 'backup':
        this.update(id, { status: 'needs2fa' })
        this.records.patchPending(id, { second: outcome.kind, autoCode: null, message: null })
        return { ok: true }
      case 'passkey-only':
        this.update(id, { status: 'stuck', attemptPath: null })
        this.records.patchPending(id, { autoCode: null })
        return { ok: true }
      case 'invalid':
        if (auto) {
          // Probably a code from an older attempt: keep watching for the right one.
          const a = this.store.find(id)
          this.records.patchPending(id, { autoCode: null, message: 'The code from your inbox didn’t work. Waiting for a newer one.' })
          if (a?.pending?.startedAt) this.inbox?.expect(id, a.email, Date.parse(a.pending.startedAt))
        }
        return { ok: false, message: outcome.message }
      case 'rate-limited':
        return { ok: false, message: 'Too many attempts. Wait a few minutes, then try again.' }
      case 'network':
        if (!outcome.sent) {
          this.checkLimit.refund(takenAt)
          this.saveLogs()
        }
        return { ok: false, message: outcome.message }
      case 'unexpected':
        if (/expired/i.test(outcome.message)) this.records.patchPending(id, { expired: true, autoCode: null })
        return { ok: false, message: outcome.message }
    }
  }

  private async finish(id: string) {
    const a = this.store.find(id)
    if (!a) return
    const backend = this.records.backend(a.partition)
    const read = await backend.readProfile()
    if (read.kind !== 'ok') {
      this.update(id, { status: 'failed', attemptPath: null, pending: { ...freshPending(), message: "Signed in, but HAM couldn't read the account details." } })
      return
    }
    const slack = await this.hooks.slackStatus(id, backend)
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
    this.hooks.signedIn(id)
  }
}
