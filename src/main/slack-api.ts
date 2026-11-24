// Slack's web API, called with the Slack session in an account's partition
// (the cookies Slack set when the account opened Slack in HAM). Nothing here is
// stored: the token is read from Slack each time HAM starts using it.
import type { Session } from 'electron'
import type { SlackFieldDef, SlackProfile } from '@shared/types'
import {
  STANDARD_KEYS,
  changedElements,
  parseClientAuth,
  parseSections,
  referencedUsers,
  sectionElements,
  sectionsOf,
  slackErrorMessage,
  UnknownElementError,
  type SlackAuth
} from './slack-profile'

const AUTH_URL = 'https://app.slack.com/auth?app=client'
const SIGNED_OUT_ERRORS = new Set(['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive', 'user_removed_from_team'])
const MAX_RETRY_WAIT = 30_000

/** Slack's session has ended: the account needs to open Slack again. */
export class SlackSignedOut extends Error {}
/** Slack turned the request down. `message` is for people. */
export class SlackRejected extends Error {}
export class SlackNetworkError extends Error {}

export interface SlackRead {
  userId: string
  profile: SlackProfile
  fields: SlackFieldDef[]
  users: Record<string, string>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class SlackApi {
  private auth: SlackAuth | null = null

  constructor(private readonly ses: Session) {}

  /** Forget the token (after sign-out or clearing the partition). */
  reset() {
    this.auth = null
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.ses.fetch(url, { ...init, signal: AbortSignal.timeout(30_000), cache: 'no-store' } as RequestInit)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new SlackNetworkError(/TimeoutError|aborted/i.test(msg) ? 'Slack took too long to respond.' : "Can't reach Slack. Check your internet connection.")
    }
  }

  private async getAuth(): Promise<SlackAuth> {
    if (this.auth) return this.auth
    const res = await this.fetch(AUTH_URL)
    // Only a page without tokens means signed out; an error page is Slack having a moment.
    if (!res.ok) throw new SlackNetworkError(`Slack isn’t responding (${res.status}). Try again in a minute.`)
    const auth = parseClientAuth(await res.text())
    if (!auth) throw new SlackSignedOut()
    this.auth = auth
    return auth
  }

  /** Call a Slack API method, getting a new token once if the old one stopped working, and waiting out rate limits. */
  async call<T = Record<string, unknown>>(method: string, params: Record<string, string> = {}): Promise<T & { ok: true }> {
    let renewed = false
    for (let attempt = 0; ; attempt++) {
      const auth = await this.getAuth()
      const res = await this.fetch(`${auth.api}api/${method}`, {
        method: 'POST',
        body: new URLSearchParams({ token: auth.token, ...params })
      })
      const json = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null
      const error = res.status === 429 ? 'ratelimited' : json?.ok ? null : (json?.error ?? `http_${res.status}`)
      if (!error) return json as T & { ok: true }
      if (error === 'ratelimited' && attempt < 3) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 3000
        if (wait <= MAX_RETRY_WAIT) {
          await sleep(wait)
          continue
        }
      }
      if (SIGNED_OUT_ERRORS.has(error)) {
        this.auth = null
        if (!renewed) {
          renewed = true
          continue
        }
        throw new SlackSignedOut()
      }
      throw new SlackRejected(slackErrorMessage(error))
    }
  }

  /** The user's whole profile: standard fields, timezone and the workspace's own fields. */
  async read(): Promise<SlackRead> {
    const { userId } = await this.getAuth()
    const [prof, info, sections] = await Promise.all([
      this.call<{ profile?: Record<string, unknown> }>('users.profile.get', { user: userId }),
      this.call<{ user?: { tz?: string } }>('users.info', { user: userId }),
      this.call('users.profile.getSections', { user: userId })
    ])
    const { fields, values } = parseSections(sectionsOf(sections))
    const profile: SlackProfile = { ...values }
    for (const key of STANDARD_KEYS) profile[key] = String(prof.profile?.[key] ?? '')
    profile.title ??= String(prof.profile?.title ?? '')
    profile.tz = info.user?.tz ?? ''
    return { userId, profile, fields, users: await this.names(referencedUsers(fields, profile)) }
  }

  /** Display names for user ids (best effort: unknown ids are left out). */
  private async names(ids: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    await Promise.all(
      ids.slice(0, 20).map(async (id) => {
        try {
          const r = await this.call<{ user?: { name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string } } }>('users.info', { user: id })
          const u = r.user
          const name = u?.profile?.display_name || u?.profile?.real_name || u?.real_name || u?.name
          if (name) out[id] = name
        } catch {
          // a name is only a label
        }
      })
    )
    return out
  }

  /** Save changed values (keyed like SlackProfile), then read the profile back. */
  async save(changes: SlackProfile): Promise<SlackRead> {
    const { userId } = await this.getAuth()
    const sections = sectionsOf(await this.call('users.profile.getSections', { user: userId }))
    const touched = changedElements(sections, changes)
    // Build every section first, so one HAM can't send back stops the save before anything is written.
    const writes: { section: string; elements: object[] }[] = []
    for (const s of sections) {
      if (!s.sectionId || !(s.profileElements ?? []).some((e) => e.elementId && touched.has(e.elementId))) continue
      try {
        writes.push({ section: s.sectionId, elements: sectionElements(s, changes) })
      } catch (err) {
        if (err instanceof UnknownElementError) throw new SlackRejected(err.message)
        throw err
      }
    }
    const standard: Record<string, string> = {}
    for (const key of STANDARD_KEYS) if (key in changes) standard[key] = changes[key].trim()
    if (Object.keys(standard).length) {
      if ('status_text' in standard || 'status_emoji' in standard) Object.assign(standard, { status_expiration: 0 })
      await this.call('users.profile.set', { profile: JSON.stringify(standard) })
    }
    if ('tz' in changes && changes.tz.trim()) await this.call('users.prefs.set', { name: 'tz', value: changes.tz.trim() })

    for (const w of writes) await this.call('users.profile.setSections', { user: userId, section: w.section, elements: JSON.stringify(w.elements) })
    return this.read()
  }
}
