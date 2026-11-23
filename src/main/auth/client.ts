// Talks to auth.hackclub.com the way its own pages do: form posts with the
// Rails CSRF token, inside one account's cookie partition.
import { session, type Session } from 'electron'
import type { ProfileInput } from '@shared/types'
import { request, NetworkError } from '../http'
import type { AuthBackend, ProfileOutcome, SaveOutcome, StartOutcome, VerifyOutcome } from './backend'
import { AUTH_ORIGIN, classifyLoginRedirect, isSignedOutRedirect, normalizeBackupCode, normalizeCode, type RawResponse } from './flow'
import { parseCsrf, parseErrors, parseProfile } from './pages'

const RATE_LIMITED = 429

export class AuthClient implements AuthBackend {
  private readonly ses: Session
  private csrf: string | null = null
  private attemptPathValue: string | null = null

  constructor(partition: string) {
    this.ses = session.fromPartition(partition)
  }

  // --- requests -----------------------------------------------------------

  private async get(path: string): Promise<RawResponse> {
    const res = await request(this.ses, path)
    this.remember(res)
    return res
  }

  private async post(path: string, fields: Record<string, string>): Promise<RawResponse> {
    const res = await request(this.ses, path, {
      form: { authenticity_token: this.csrf ?? '', ...fields }
    })
    this.remember(res)
    return res
  }

  /** Keep the newest CSRF token: it rotates when the session is reset at sign-in. */
  private remember(res: RawResponse) {
    if (res.body) {
      const token = parseCsrf(res.body)
      if (token) this.csrf = token
    }
  }

  private firstError(res: RawResponse, fallback: string): string {
    return parseErrors(res.body)[0] ?? fallback
  }

  // --- sign-in ------------------------------------------------------------

  async startLogin(email: string): Promise<StartOutcome> {
    return guard(async () => {
      this.attemptPathValue = null
      const page = await this.get('/login')
      if (page.status === RATE_LIMITED) return { kind: 'rate-limited' }
      if (!this.csrf) return { kind: 'unexpected', message: "Couldn't load the Hack Club sign-in page." }

      const res = await this.post('/login', {
        email: email.trim().toLowerCase(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
      return this.afterLoginStart(res)
    }, startError)
  }

  private async afterLoginStart(res: RawResponse): Promise<StartOutcome> {
    if (res.status === RATE_LIMITED) return { kind: 'rate-limited' }
    if (!res.location) {
      return { kind: 'unexpected', message: this.firstError(res, `Unexpected response (${res.status}).`) }
    }
    const next = classifyLoginRedirect(res.location)
    switch (next.kind) {
      case 'signup':
        return { kind: 'no-account' }
      case 'attempt':
        this.attemptPathValue = next.attemptPath
        await this.get(next.attemptPath) // the code page carries the CSRF token for /verify
        return { kind: 'code' }
      case 'webauthn': {
        // Passkey accounts are sent to WebAuthn first. HAM never uses passkeys:
        // skip straight to an emailed code, as the page's "use email" link does.
        this.attemptPathValue = next.attemptPath
        await this.get(`${next.attemptPath}/webauthn`)
        const skipped = await this.post(`${next.attemptPath}/webauthn/skip`, {})
        if (skipped.status === RATE_LIMITED) return { kind: 'rate-limited' }
        await this.get(next.attemptPath)
        return { kind: 'code' }
      }
      case 'login': {
        // Errors such as a locked account come back as a flash on /login.
        const page = await this.get('/login')
        return { kind: 'locked', message: this.firstError(page, "Hack Club couldn't start a sign-in for this email.") }
      }
      default:
        return { kind: 'unexpected', message: `Unexpected redirect to ${res.location}.` }
    }
  }

  async resend(): Promise<StartOutcome> {
    return guard(async () => {
      if (!this.attemptPathValue) return { kind: 'unexpected', message: 'This sign-in has expired. Start again.' }
      const res = await this.post(`${this.attemptPathValue}/resend`, {})
      if (res.status === RATE_LIMITED) return { kind: 'rate-limited' }
      await this.get(this.attemptPathValue)
      return { kind: 'code' }
    }, startError)
  }

  async verifyEmailCode(code: string): Promise<VerifyOutcome> {
    return guard(async () => {
      if (!this.attemptPathValue) return expired()
      const res = await this.post(`${this.attemptPathValue}/verify`, { code: normalizeCode(code) })
      return this.afterVerify(res)
    }, verifyError)
  }

  async verifySecondFactor(kind: 'totp' | 'backup', code: string): Promise<VerifyOutcome> {
    return guard(async () => {
      if (!this.attemptPathValue) return expired()
      const path = kind === 'totp' ? `${this.attemptPathValue}/totp` : `${this.attemptPathValue}/backup_code`
      if (!this.csrf) await this.get(path)
      const value = kind === 'totp' ? normalizeCode(code) : normalizeBackupCode(code)
      const res = await this.post(path, { code: value })
      return this.afterVerify(res)
    }, verifyError)
  }

  private async afterVerify(res: RawResponse): Promise<VerifyOutcome> {
    if (res.status === RATE_LIMITED) return { kind: 'rate-limited' }
    if (!res.location) {
      // A wrong code re-renders the form (422) with a flash error.
      return { kind: 'invalid', message: this.firstError(res, 'Invalid or expired code, please try again') }
    }
    const next = classifyLoginRedirect(res.location)
    switch (next.kind) {
      case 'done':
        return { kind: 'done' }
      case 'totp':
        await this.get(`${next.attemptPath}/totp`)
        return { kind: 'totp' }
      case 'backup':
        await this.get(`${next.attemptPath}/backup_code`)
        return { kind: 'backup' }
      case 'webauthn':
        // The server asks for a passkey as the second factor. A backup code
        // may still work, so prepare that form in case the user has one.
        await this.get(`${next.attemptPath}/backup_code`)
        return { kind: 'passkey-only' }
      case 'attempt':
        await this.get(next.attemptPath)
        return { kind: 'invalid', message: 'Invalid or expired code, please try again' }
      case 'login': {
        const page = await this.get('/login')
        return { kind: 'unexpected', message: this.firstError(page, 'This sign-in has expired. Start again.') }
      }
      default:
        return { kind: 'unexpected', message: `Unexpected redirect to ${res.location}.` }
    }
  }

  // --- profile ------------------------------------------------------------

  async readProfile(): Promise<ProfileOutcome> {
    return guard(async () => {
      const res = await this.get('/identity/edit')
      if (isSignedOutRedirect(res)) return { kind: 'signed-out' }
      const profile = res.status === 200 ? parseProfile(res.body) : null
      if (!profile) return { kind: 'unexpected', message: `Couldn't read the account page (${res.status}).` }
      return { kind: 'ok', profile }
    }, (message) => ({ kind: 'unexpected', message }))
  }

  async saveProfile(input: ProfileInput): Promise<SaveOutcome> {
    return guard(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!this.csrf || attempt > 0) {
          const fresh = await this.readProfile()
          if (fresh.kind !== 'ok') return fresh
        }
        // Only these three fields: leaving developer_mode out keeps it unchanged.
        const res = await this.post('/identity', {
          _method: 'patch',
          'identity[first_name]': input.firstName.trim(),
          'identity[last_name]': input.lastName.trim(),
          'identity[phone_number]': input.phone.trim()
        })
        if (isSignedOutRedirect(res)) return { kind: 'signed-out' }
        if (res.location) {
          // Saved: the server redirects back to the edit page. Read it to confirm.
          const after = await this.readProfile()
          if (after.kind === 'ok') return { kind: 'ok', profile: after.profile }
          return after
        }
        if (res.status === 422) continue // stale CSRF token: fetch a new one and retry once
        const messages = parseErrors(res.body)
        if (messages.length > 0) return { kind: 'validation', messages }
        return { kind: 'unexpected', message: `Unexpected response (${res.status}).` }
      }
      return { kind: 'unexpected', message: 'Hack Club rejected the save. Refresh and try again.' }
    }, (message) => ({ kind: 'unexpected', message }))
  }

  // --- session ------------------------------------------------------------

  async signOut(): Promise<boolean> {
    try {
      if (!this.csrf) {
        const home = await this.get('/')
        if (isSignedOutRedirect(home)) return true
      }
      const res = await this.post('/logout', { _method: 'delete' })
      return res.status >= 300 && res.status < 400
    } catch {
      return false
    }
  }

  async sessionExpiry(): Promise<string | null> {
    const cookies = await this.ses.cookies.get({ url: AUTH_ORIGIN, name: 'session_token' })
    const expiry = cookies[0]?.expirationDate
    return expiry ? new Date(expiry * 1000).toISOString() : null
  }

  attemptPath(): string | null {
    return this.attemptPathValue
  }

  async resumeAttempt(path: string): Promise<boolean> {
    try {
      const res = await this.get(path)
      if (res.status >= 500) return false
      if (res.location) {
        // Past the email step, the attempt page forwards to the next factor.
        const next = classifyLoginRedirect(res.location)
        if (next.kind === 'totp' || next.kind === 'backup' || next.kind === 'webauthn') {
          await this.get(`${next.attemptPath}/${next.kind === 'totp' ? 'totp' : 'backup_code'}`)
          this.attemptPathValue = next.attemptPath
          return true
        }
        return false // expired: back to /login
      }
      this.attemptPathValue = path
      return true
    } catch {
      return false
    }
  }

  async hasSlackSession(): Promise<boolean> {
    const cookies = await this.ses.cookies.get({ domain: 'slack.com', name: 'd' })
    return cookies.some((c) => !c.expirationDate || c.expirationDate * 1000 > Date.now())
  }

  /** The current CSRF token, fetching the home page if there isn't one yet. */
  async csrfToken(): Promise<string | null> {
    if (!this.csrf) await this.get('/')
    return this.csrf
  }

  async clearLocalData(): Promise<void> {
    this.csrf = null
    this.attemptPathValue = null
    await this.ses.clearStorageData()
    await this.ses.clearCache()
  }
}

function expired(): VerifyOutcome {
  return { kind: 'unexpected', message: 'This sign-in has expired. Start again.' }
}

const startError = (message: string): StartOutcome => ({ kind: 'unexpected', message })
const verifyError = (message: string): VerifyOutcome => ({ kind: 'unexpected', message })

async function guard<T>(fn: () => Promise<T>, onError: (message: string) => T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof NetworkError) return onError(err.message)
    return onError(err instanceof Error ? err.message : String(err))
  }
}
