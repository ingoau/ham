// A fake auth.hackclub.com for demos, screenshots and UI tests. Enabled with
// HAM_MOCK=1. Behaviour matches the design prototype:
//   - an email containing "new" has no account
//   - an email starting with "2fa" asks for an authenticator code
//   - an email containing "passkey" requires 2FA with only a passkey
//   - the code 000000 is always wrong; any other 6 digits work
import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProfileInput, SlackFieldDef, SlackInfo, SlackProfile } from '@shared/types'
import type { AuthBackend, ProfileOutcome, SaveOutcome, SlackOutcome, StartOutcome, VerifyOutcome } from './backend'
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
  /** Slack profile values by partition. */
  slackProfiles?: Record<string, SlackProfile>
}

const field = (id: string, section: string, sectionLabel: string, label: string, kind: SlackFieldDef['kind'], key: string, extra: Partial<SlackFieldDef> = {}): SlackFieldDef => ({
  id,
  section,
  sectionLabel,
  label,
  hint: '',
  kind,
  editable: true,
  key,
  ...extra
})

/** A few of Hack Club Slack's own fields, one of each kind. */
export const MOCK_SLACK_FIELDS: SlackFieldDef[] = [
  field('PeDEMO1', 'PsHEAD', 'Header', 'Name Pronunciation', 'text', 'name_pronunciation', { sectionType: 'HEADER' }),
  field('PeDEMO2', 'PsPEOPLE', 'People', 'Manager', 'person', 'manager'),
  field('PeDEMO3', 'PsABOUT', 'About me', 'Website', 'link', 'website'),
  field('PeDEMO4', 'PsABOUT', 'About me', 'School', 'text', 'school'),
  field('PeDEMO5', 'PsABOUT', 'About me', 'Birthday', 'date', 'birthday', { hint: 'Share your birthday so other Hack Clubbers know when to 🎉' }),
  field('PeDEMO6', 'PsABOUT', 'About me', 'Fav Food(s)', 'text', 'fav_food_s', { hint: 'e.g. tacos, cake, microwaved apples' }),
  field('PeDEMO7', 'PsABOUT', 'About me', 'Hack Club Gold since', 'text', 'hack_club_gold_since', { editable: false })
]

const slackIdFor = (email: string) => `U0DEMO${email.length}`

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

  async slackId(): Promise<string | null | undefined> {
    const db = loadDb()
    const email = db.sessions[this.partition]?.email ?? ''
    // Demo: the Fiona accounts and anything with "slack" in it are on Slack.
    return db.slack?.[this.partition] || /fiona|slack/.test(email) ? slackIdFor(email) : null
  }

  async readSlack(): Promise<SlackOutcome> {
    await wait(250)
    const db = loadDb()
    if (db.slack?.[this.partition] !== true) return { kind: 'signed-out' }
    const email = db.sessions[this.partition]?.email ?? ''
    const profile = { ...(db.slackProfiles?.[this.partition] ?? {}) }
    const users: Record<string, string> = {}
    for (const [part, s] of Object.entries(db.sessions)) users[slackIdFor(s.email)] = db.slackProfiles?.[part]?.display_name || s.email
    return { kind: 'ok', userId: slackIdFor(email), profile, fields: MOCK_SLACK_FIELDS, users }
  }

  async saveSlack(changes: SlackProfile): Promise<SlackOutcome> {
    await wait(400)
    if (changes.status_emoji === ':nope:') return { kind: 'rejected', message: 'Slack doesn’t know that status emoji.' }
    const db = loadDb()
    if (db.slack?.[this.partition] !== true) return { kind: 'signed-out' }
    db.slackProfiles ??= {}
    db.slackProfiles[this.partition] = { ...(db.slackProfiles[this.partition] ?? {}), ...changes }
    saveDb(db)
    return this.readSlack()
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
    { partition: 'persist:acct-demo-1', email: 'fiona@example.com', profile: { firstName: 'Fiona', lastName: 'Hackworth', phone: '+1 (555) 201-4410', hasLegalName: false }, expiresAt: new Date(now + 28 * DAY).toISOString(), signedIn: true, slack: { linked: true, session: true, profile: { real_name: 'Fiona Hackworth', display_name: 'fiona', title: 'Club leader', pronouns: 'she/her', tz: 'Australia/Sydney', status_emoji: '', status_text: '', PeDEMO1: 'FEE-oh-nuh', PeDEMO2: '', 'PeDEMO3.text': 'fiona.dev', 'PeDEMO3.url': 'https://fiona.dev', PeDEMO4: 'Hackworth High', PeDEMO5: '', PeDEMO6: 'Dumplings', PeDEMO7: '2025' } } },
    { partition: 'persist:acct-demo-2', email: 'fiona.leads@example.org', profile: { firstName: 'Fiona', lastName: 'Hackworth', phone: '', hasLegalName: true }, expiresAt: new Date(now + 16 * DAY).toISOString(), signedIn: true, slack: { linked: true, session: false, profile: { real_name: 'Fiona Hackworth', display_name: 'fiona-leads' } } },
    { partition: 'persist:acct-demo-3', email: 'sam.rivera@example.net', profile: { firstName: 'Sam', lastName: 'Rivera', phone: '+44 7700 900123', hasLegalName: false }, expiresAt: new Date(now - 21 * DAY).toISOString(), signedIn: false, slack: { linked: null, session: false, profile: {} } }
  ]
  const db: MockDb = { profiles: {}, sessions: {}, slack: { 'persist:acct-demo-1': true }, slackProfiles: {} }
  for (const s of seed) {
    db.profiles[s.email] = s.profile
    db.slackProfiles![s.partition] = s.slack.profile
    db.sessions[s.partition] = { email: s.email, signedIn: s.signedIn, expiresAt: s.expiresAt }
  }
  saveDb(db)
  return seed
}
