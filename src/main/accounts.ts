// Owns the account list and every in-progress sign-in. Each account (and each
// sign-in attempt for a new account) gets its own session partition.
import { randomUUID } from 'node:crypto'
import type { Account, ProfileInput, RefreshResult, SaveResult, SignInResult } from '@shared/types'
import type { AuthBackend, BackendFactory, StartOutcome, VerifyOutcome } from './auth/backend'
import { isValidEmail } from './auth/flow'
import type { Store, StoredAccount } from './store'

interface Attempt {
  id: string
  email: string
  partition: string
  /** Set when signing an existing account in again. */
  accountId: string | null
  /** The partition was made for this attempt and should be wiped if it fails. */
  fresh: boolean
}

const REFRESH_INTERVAL = 5 * 60 * 1000

export class AccountService {
  private readonly attempts = new Map<string, Attempt>()
  private readonly backends = new Map<string, AuthBackend>()
  private lastRefreshAll = 0

  constructor(
    private readonly store: Store,
    private readonly makeBackend: BackendFactory,
    private readonly onChange: () => void
  ) {}

  list(): Account[] {
    return this.store.accounts.map(toPublic)
  }

  private backend(partition: string): AuthBackend {
    let b = this.backends.get(partition)
    if (!b) {
      b = this.makeBackend(partition)
      this.backends.set(partition, b)
    }
    return b
  }

  partitionOf(accountId: string): string | null {
    return this.store.find(accountId)?.partition ?? null
  }

  // --- sign-in ------------------------------------------------------------

  async start(rawEmail: string, accountId?: string): Promise<SignInResult> {
    const attemptId = randomUUID()
    const email = rawEmail.trim().toLowerCase()
    if (!isValidEmail(email)) return { attemptId, error: 'invalid-email' }

    const target = accountId ? this.store.find(accountId) : this.store.findByEmail(email)
    if (!accountId && target?.status === 'signed-in') {
      return { attemptId, step: 'done', accountId: target.id, existing: true }
    }

    const attempt: Attempt = {
      id: attemptId,
      email: target?.email ?? email,
      partition: target?.partition ?? `persist:acct-${randomUUID()}`,
      accountId: target?.id ?? null,
      fresh: !target
    }
    const backend = this.backend(attempt.partition)
    // Start from a clean cookie jar so an old, expired session can't interfere.
    await backend.clearLocalData()
    this.attempts.set(attemptId, attempt)

    const outcome = await backend.startLogin(attempt.email)
    return this.afterStart(attempt, outcome)
  }

  async resend(attemptId: string): Promise<SignInResult> {
    const attempt = this.attempts.get(attemptId)
    if (!attempt) return { attemptId, error: 'unexpected', message: 'This sign-in has expired. Start again.' }
    return this.afterStart(attempt, await this.backend(attempt.partition).resend())
  }

  private async afterStart(attempt: Attempt, outcome: StartOutcome): Promise<SignInResult> {
    const attemptId = attempt.id
    switch (outcome.kind) {
      case 'code':
        return { attemptId, step: 'code', email: attempt.email }
      case 'no-account':
        await this.drop(attempt)
        return { attemptId, error: 'no-account' }
      case 'rate-limited':
        return { attemptId, error: 'rate-limited' }
      case 'locked':
        await this.drop(attempt)
        return { attemptId, error: 'locked', message: outcome.message }
      case 'unexpected':
        return { attemptId, error: 'unexpected', message: outcome.message }
    }
  }

  async submitEmailCode(attemptId: string, code: string): Promise<SignInResult> {
    const attempt = this.attempts.get(attemptId)
    if (!attempt) return { attemptId, error: 'unexpected', message: 'This sign-in has expired. Start again.' }
    return this.afterVerify(attempt, await this.backend(attempt.partition).verifyEmailCode(code))
  }

  async submitSecondFactor(attemptId: string, kind: 'totp' | 'backup', code: string): Promise<SignInResult> {
    const attempt = this.attempts.get(attemptId)
    if (!attempt) return { attemptId, error: 'unexpected', message: 'This sign-in has expired. Start again.' }
    return this.afterVerify(attempt, await this.backend(attempt.partition).verifySecondFactor(kind, code))
  }

  private async afterVerify(attempt: Attempt, outcome: VerifyOutcome): Promise<SignInResult> {
    const attemptId = attempt.id
    switch (outcome.kind) {
      case 'done':
        return this.finish(attempt)
      case 'totp':
      case 'backup':
      case 'passkey-only':
        return { attemptId, step: outcome.kind }
      case 'invalid':
        return { attemptId, error: 'invalid-code', message: outcome.message }
      case 'rate-limited':
        return { attemptId, error: 'rate-limited' }
      case 'unexpected':
        return { attemptId, error: 'unexpected', message: outcome.message }
    }
  }

  private async finish(attempt: Attempt): Promise<SignInResult> {
    const backend = this.backend(attempt.partition)
    const read = await backend.readProfile()
    if (read.kind !== 'ok') {
      return { attemptId: attempt.id, error: 'unexpected', message: "Signed in, but HAM couldn't read the account details." }
    }
    const id = attempt.accountId ?? randomUUID()
    const previous = this.store.find(id)
    this.store.upsert({
      id,
      email: attempt.email,
      ...read.profile,
      status: 'signed-in',
      expiresAt: await backend.sessionExpiry(),
      addedAt: previous?.addedAt ?? new Date().toISOString(),
      partition: attempt.partition
    })
    this.attempts.delete(attempt.id)
    this.onChange()
    return { attemptId: attempt.id, step: 'done', accountId: id, existing: attempt.accountId !== null }
  }

  async cancel(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId)
    if (attempt) await this.drop(attempt)
  }

  private async drop(attempt: Attempt) {
    this.attempts.delete(attempt.id)
    if (attempt.fresh) {
      await this.backend(attempt.partition).clearLocalData()
      this.backends.delete(attempt.partition)
    }
  }

  // --- accounts -----------------------------------------------------------

  async refresh(accountId: string): Promise<RefreshResult> {
    const account = this.store.find(accountId)
    if (!account) return { ok: false, reason: 'unexpected', message: 'Account not found.' }
    const backend = this.backend(account.partition)
    const read = await backend.readProfile()
    if (read.kind === 'signed-out') {
      this.update(account, { status: 'signed-out' })
      return { ok: false, reason: 'signed-out' }
    }
    if (read.kind === 'unexpected') return { ok: false, reason: 'network', message: read.message }
    const next = this.update(account, {
      ...read.profile,
      status: 'signed-in',
      expiresAt: (await backend.sessionExpiry()) ?? account.expiresAt
    })
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
      if (a.status === 'signed-in' && a.expiresAt && Date.parse(a.expiresAt) < now) {
        this.update(a, { status: 'signed-out' })
      }
    }
  }

  async save(accountId: string, input: ProfileInput): Promise<SaveResult> {
    const account = this.store.find(accountId)
    if (!account) return { ok: false, reason: 'unexpected', message: 'Account not found.' }
    const messages: string[] = []
    if (!input.firstName.trim()) messages.push("First name can't be blank")
    if (!input.lastName.trim()) messages.push("Last name can't be blank")
    if (messages.length) return { ok: false, reason: 'validation', messages }

    const result = await this.backend(account.partition).saveProfile(input)
    switch (result.kind) {
      case 'ok':
        return { ok: true, account: toPublic(this.update(account, { ...result.profile, status: 'signed-in' })) }
      case 'validation':
        return { ok: false, reason: 'validation', messages: result.messages }
      case 'signed-out':
        this.update(account, { status: 'signed-out' })
        return { ok: false, reason: 'signed-out' }
      case 'unexpected':
        return { ok: false, reason: 'unexpected', message: result.message }
    }
  }

  async signOut(accountId: string): Promise<{ serverSignedOut: boolean }> {
    const account = this.store.find(accountId)
    if (!account) return { serverSignedOut: false }
    const backend = this.backend(account.partition)
    const serverSignedOut = account.status === 'signed-in' ? await backend.signOut() : true
    await backend.clearLocalData()
    this.backends.delete(account.partition)
    this.store.remove(accountId)
    this.onChange()
    return { serverSignedOut }
  }

  move(accountId: string, toIndex: number) {
    this.store.move(accountId, toIndex)
    this.onChange()
  }

  private update(account: StoredAccount, patch: Partial<StoredAccount>): StoredAccount {
    const next = { ...account, ...patch }
    this.store.upsert(next)
    this.onChange()
    return next
  }
}

function toPublic(a: StoredAccount): Account {
  const { partition, ...rest } = a
  void partition // never sent to the renderer
  return rest
}
