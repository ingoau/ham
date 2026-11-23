// A fake auth.hackclub.com for demos, screenshots and UI tests. Enabled with
// HAM_MOCK=1. Behaviour matches the design prototype:
//   - an email containing "new" has no account
//   - an email starting with "2fa" asks for an authenticator code
//   - an email containing "passkey" requires 2FA with only a passkey
//   - the code 000000 is always wrong; any other 6 digits work
import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProfileInput, SlackInfo } from '@shared/types'
import type { AuthBackend, ProfileOutcome, SaveOutcome, StartOutcome, VerifyOutcome } from './backend'
import type { ParsedProfile } from './pages'
import { normalizeCode } from './flow'

interface MockSession {
  email: string
  signedIn: boolean
  expiresAt: string
}

interface MockDb {
  profiles: Record<string, ParsedProfile>
  sessions: Record<string, MockSession>
  /** In-progress sign-ins by partition, so they survive a restart. */
  attempts?: Record<string, { email: string; stage: 'code' | '2fa' }>
  /** Partitions with a Slack session. */
  slack?: Record<string, boolean>
}

const DAY = 24 * 60 * 60 * 1000

function dbPath() {
  return join(app.getPath('userData'), 'mock-server.json')
}

function loadDb(): MockDb {
  try {
    return JSON.parse(readFileSync(dbPath(), 'utf8')) as MockDb
  } catch {
    return { profiles: {}, sessions: {} }
  }
}

function saveDb(db: MockDb) {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(dbPath(), JSON.stringify(db, null, 2))
}

function nameFromEmail(email: string): ParsedProfile {
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '')
  const parts = email
    .split('@')[0]
    .split(/[._+-]/)
    .filter((p) => /^[a-z]+$/i.test(p) && !/^(passkey|new|fa)$/i.test(p))
  return { firstName: cap(parts[0] ?? '') || 'New', lastName: cap(parts[1] ?? '') || 'Member', phone: '', hasLegalName: false }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class MockBackend implements AuthBackend {
  private pendingEmail: string | null = null

  constructor(private readonly partition: string) {}

  private saveAttempt(stage: 'code' | '2fa' | null) {
    const db = loadDb()
    db.attempts ??= {}
    if (stage && this.pendingEmail) db.attempts[this.partition] = { email: this.pendingEmail, stage }
    else delete db.attempts[this.partition]
    saveDb(db)
  }

  async startLogin(email: string): Promise<StartOutcome> {
    await wait(500)
    const lower = email.trim().toLowerCase()
    if (/new/.test(lower.split('@')[0])) return { kind: 'no-account' }
    this.pendingEmail = lower
    this.saveAttempt('code')
    return { kind: 'code' }
  }

  async resend(): Promise<StartOutcome> {
    await wait(300)
    return { kind: 'code' }
  }

  async verifyEmailCode(code: string): Promise<VerifyOutcome> {
    await wait(500)
    if (!this.pendingEmail) return { kind: 'unexpected', message: 'This sign-in has expired. Start again.' }
    if (normalizeCode(code) === '000000') return { kind: 'invalid', message: 'Invalid or expired code, please try again' }
    if (/passkey/.test(this.pendingEmail)) return { kind: 'passkey-only' }
    if (/^2fa/.test(this.pendingEmail)) {
      this.saveAttempt('2fa')
      return { kind: 'totp' }
    }
    return this.complete()
  }

  async verifySecondFactor(_kind: 'totp' | 'backup', code: string): Promise<VerifyOutcome> {
    await wait(500)
    if (code.replace(/[^0-9a-z]/gi, '') === '000000') return { kind: 'invalid', message: 'Invalid code, please try again' }
    return this.complete()
  }

  private complete(): VerifyOutcome {
    const db = loadDb()
    const email = this.pendingEmail!
    db.profiles[email] ??= nameFromEmail(email)
    db.sessions[this.partition] = { email, signedIn: true, expiresAt: new Date(Date.now() + 30 * DAY).toISOString() }
    if (db.attempts) delete db.attempts[this.partition]
    saveDb(db)
    this.pendingEmail = null
    return { kind: 'done' }
  }

  private current(db: MockDb): { email: string; profile: ParsedProfile } | null {
    const s = db.sessions[this.partition]
    if (!s?.signedIn || Date.parse(s.expiresAt) < Date.now()) return null
    const profile = db.profiles[s.email]
    return profile ? { email: s.email, profile } : null
  }

  async readProfile(): Promise<ProfileOutcome> {
    await wait(250)
    const cur = this.current(loadDb())
    return cur ? { kind: 'ok', profile: cur.profile } : { kind: 'signed-out' }
  }

  async saveProfile(input: ProfileInput): Promise<SaveOutcome> {
    await wait(700)
    const db = loadDb()
    const cur = this.current(db)
    if (!cur) return { kind: 'signed-out' }
    const messages: string[] = []
    if (!input.firstName.trim()) messages.push("First name can't be blank")
    if (!input.lastName.trim()) messages.push("Last name can't be blank")
    if (messages.length) return { kind: 'validation', messages }
    const profile = { ...cur.profile, firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone: input.phone.trim() }
    db.profiles[cur.email] = profile
    saveDb(db)
    return { kind: 'ok', profile }
  }

  async signOut(): Promise<boolean> {
    await wait(300)
    const db = loadDb()
    delete db.sessions[this.partition]
    saveDb(db)
    return true
  }

  async sessionExpiry(): Promise<string | null> {
    return loadDb().sessions[this.partition]?.expiresAt ?? null
  }

  async clearLocalData(): Promise<void> {
    this.pendingEmail = null
    this.saveAttempt(null)
  }

  attemptPath(): string | null {
    return this.pendingEmail ? `/login/mock-${this.partition.replace(/\W/g, '')}` : null
  }

  async resumeAttempt(): Promise<boolean> {
    const attempt = loadDb().attempts?.[this.partition]
    if (!attempt) return false
    this.pendingEmail = attempt.email
    return true
  }

  async hasSlackSession(): Promise<boolean> {
    return loadDb().slack?.[this.partition] === true
  }

  /** Demo only: pretend the Slack popup signed in. */
  static markSlackSession(partition: string) {
    const db = loadDb()
    db.slack ??= {}
    db.slack[partition] = true
    saveDb(db)
  }
}

/** Demo accounts for screenshots: two for one person, and one signed out. */
export function seedMockData(): { partition: string; email: string; profile: ParsedProfile; expiresAt: string; signedIn: boolean; slack: SlackInfo }[] {
  const now = Date.now()
  const seed: { partition: string; email: string; profile: ParsedProfile; expiresAt: string; signedIn: boolean; slack: SlackInfo }[] = [
    { partition: 'persist:acct-demo-1', email: 'fiona@example.com', profile: { firstName: 'Fiona', lastName: 'Hackworth', phone: '+1 (555) 201-4410', hasLegalName: false }, expiresAt: new Date(now + 28 * DAY).toISOString(), signedIn: true, slack: { linked: true, session: true, profile: { real_name: 'Fiona Hackworth', display_name: 'fiona', title: 'Club leader', pronouns: 'she/her', tz: 'Australia/Sydney' } } },
    { partition: 'persist:acct-demo-2', email: 'fiona.leads@example.org', profile: { firstName: 'Fiona', lastName: 'Hackworth', phone: '', hasLegalName: true }, expiresAt: new Date(now + 16 * DAY).toISOString(), signedIn: true, slack: { linked: true, session: false, profile: { real_name: 'Fiona Hackworth', display_name: 'fiona-leads' } } },
    { partition: 'persist:acct-demo-3', email: 'sam.rivera@example.net', profile: { firstName: 'Sam', lastName: 'Rivera', phone: '+44 7700 900123', hasLegalName: false }, expiresAt: new Date(now - 21 * DAY).toISOString(), signedIn: false, slack: { linked: null, session: false, profile: {} } }
  ]
  const db: MockDb = { profiles: {}, sessions: {}, slack: { 'persist:acct-demo-1': true } }
  for (const s of seed) {
    db.profiles[s.email] = s.profile
    db.sessions[s.partition] = { email: s.email, signedIn: s.signedIn, expiresAt: s.expiresAt }
  }
  saveDb(db)
  return seed
}
