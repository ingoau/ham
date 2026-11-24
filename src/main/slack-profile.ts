// Reading and writing Slack profiles the way Slack's own web client does,
// as pure functions over Slack's JSON (the requests live in slack-api.ts).
//
// - The web client's API token comes from app.slack.com/auth?app=client, which
//   answers a signed-in browser (the `d` cookie) with each workspace's tokens.
//   Hack Club is an Enterprise Grid org: its enterprise token works for every
//   call below, on the org's own host.
// - Standard fields (full name, display name, pronouns, status) save with
//   users.profile.set; the timezone with users.prefs.set.
// - The workspace's own fields, title included, are "profile elements" in
//   sections. users.profile.getSections lists them with their values, and
//   users.profile.setSections saves one whole section at a time.
import { slugKey } from '@shared/fields'
import type { SlackFieldDef, SlackFieldKind, SlackProfile, SlackTokens } from '@shared/types'

/** Hack Club's Slack workspace. */
export const HACK_CLUB_TEAM = 'T0266FRGM'

/** The standard fields users.profile.set takes. */
export const STANDARD_KEYS = ['real_name', 'display_name', 'pronouns', 'status_emoji', 'status_text'] as const

/** Slack's status_expiration (Unix seconds, 0 for never) as HAM keeps it: an ISO time, or '' for never. */
export function expiryFromSlack(seconds: unknown): string {
  const n = Number(seconds)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().replace('.000Z', 'Z') : ''
}

/** HAM's status expiry back to Slack's Unix seconds (0 for never). */
export function expiryToSlack(value: string): number {
  const ms = Date.parse(value.trim())
  return value.trim() && Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

export interface SlackAuth {
  token: string
  /** Origin for API calls, e.g. "https://hackclub.enterprise.slack.com/". */
  api: string
  userId: string
}

interface ClientTeam {
  id?: string
  url?: string
  domain?: string
  token?: string
  user_id?: string
  enterprise_id?: string
  enterprise_api_token?: string
}

/** The Hack Club workspace and its org from app.slack.com/auth?app=client, or null if the page has none. */
function clientTeams(html: string): { team: ClientTeam; userId: string; org?: ClientTeam } | null {
  const m = /incomingConfig\s*=\s*JSON\.stringify\((\{.*\})\);/s.exec(html)
  if (!m) return null
  let teams: Record<string, ClientTeam>
  try {
    teams = (JSON.parse(m[1]) as { teams?: Record<string, ClientTeam> }).teams ?? {}
  } catch {
    return null
  }
  const team = teams[HACK_CLUB_TEAM] ?? Object.values(teams).find((t) => t.domain === 'hackclub' && !t.id?.startsWith('E'))
  if (!team?.user_id) return null
  return { team, userId: team.user_id, org: team.enterprise_id ? teams[team.enterprise_id] : undefined }
}

/** The Hack Club token from app.slack.com/auth?app=client, or null if the page has none (signed out). */
export function parseClientAuth(html: string): SlackAuth | null {
  const found = clientTeams(html)
  if (!found) return null
  const { team, userId, org } = found
  if (team.enterprise_api_token && org?.url) return { token: team.enterprise_api_token, api: withSlash(org.url), userId }
  if (team.token && team.url) return { token: team.token, api: withSlash(team.url), userId }
  return null
}

/** Both of the web client's Hack Club tokens (xoxc), or null if the page has none (signed out). */
export function parseClientTokens(html: string): Omit<SlackTokens, 'xoxd'> | null {
  const found = clientTeams(html)
  if (!found) return null
  const { team, userId, org } = found
  const xoxc = (t?: string) => (t?.startsWith('xoxc-') ? t : undefined)
  const teamToken = xoxc(team.token)
  // The org's own token; the workspace's enterprise_api_token is the same kind.
  const orgToken = xoxc(org?.token) ?? xoxc(team.enterprise_api_token)
  const orgId = org?.id ?? team.enterprise_id
  if (!teamToken && !orgToken) return null
  return {
    userId,
    team: teamToken && team.id ? { id: team.id, token: teamToken } : null,
    enterprise: orgToken && orgId ? { id: orgId, token: orgToken } : null
  }
}

const withSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`)

/** A profile element from users.profile.getSections (only the parts HAM uses). */
export interface RawElement {
  __typename?: string
  elementId?: string
  elementKey?: string
  label?: string
  hint?: string
  isHidden?: boolean
  isScimManaged?: boolean
  permissions?: { ui?: boolean }
  text?: string | null
  date?: string | null
  uri?: string | null
  displayText?: string | null
  persons?: (string | { id?: string })[] | null
  fileId?: string | null
  blocks?: unknown
  tags?: unknown
  city?: string
  country?: string
  description?: string
  state?: string
}

export interface RawSection {
  sectionId?: string
  label?: string
  type?: string
  profileElements?: RawElement[] | null
}

/** The sections in a users.profile.getSections response. */
export function sectionsOf(res: unknown): RawSection[] {
  const r = res as { result?: { data?: { user?: { profileSections?: RawSection[] } } } }
  return r?.result?.data?.user?.profileSections ?? []
}

const KINDS: Record<string, SlackFieldKind> = {
  ProfileTextElement: 'text',
  ProfileDateElement: 'date',
  ProfileLinkElement: 'link',
  ProfilePersonElement: 'person'
}

/** Slack's own fields that HAM shows elsewhere: the title (a standard field) and the email (the account's). */
const ELSEWHERE = new Set(['title', 'email'])

const personIds = (e: RawElement): string[] =>
  (e.persons ?? []).map((p) => (typeof p === 'string' ? p : (p?.id ?? ''))).filter(Boolean)

export interface ParsedSections {
  fields: SlackFieldDef[]
  /** Values for the fields, plus `title`. */
  values: SlackProfile
}

/** The workspace's own fields and this user's values for them. */
export function parseSections(sections: RawSection[]): ParsedSections {
  const fields: SlackFieldDef[] = []
  const values: SlackProfile = {}
  const used = new Set<string>()
  for (const s of sections) {
    for (const e of s.profileElements ?? []) {
      const id = e.elementId
      if (!id) continue
      if (e.elementKey === 'title') {
        values.title = e.text ?? ''
        continue
      }
      const kind = KINDS[e.__typename ?? '']
      // Fields without a visible label (Hack Club has a "\u200b" one) are decoration, not data.
      const label = (e.label ?? '').replace(/[\u200b-\u200d\ufeff]/g, '').trim()
      if (!kind || !label || e.isHidden || ELSEWHERE.has(e.elementKey ?? '')) continue
      let key = slugKey(label, id)
      for (let n = 2; used.has(key); n++) key = `${slugKey(label, id)}_${n}`
      used.add(key)
      fields.push({
        id,
        section: s.sectionId ?? '',
        sectionLabel: s.label ?? '',
        sectionType: s.type ?? '',
        label,
        hint: (e.hint ?? '').trim(),
        kind,
        // Slack's own form also leaves out SCIM-managed people fields.
        editable: e.permissions?.ui === true && !(kind === 'person' && e.isScimManaged),
        key
      })
      if (kind === 'link') {
        values[`${id}.text`] = e.displayText ?? ''
        values[`${id}.url`] = e.uri ?? ''
      } else if (kind === 'person') {
        values[id] = personIds(e).join(',')
      } else {
        values[id] = (kind === 'date' ? e.date : e.text) ?? ''
      }
    }
  }
  return { fields, values }
}

/** Which element ids a change to these value keys touches ("Pe1.url" → "Pe1"; "title" → the title element). */
export function changedElements(sections: RawSection[], changes: SlackProfile): Set<string> {
  const ids = new Set<string>()
  for (const key of Object.keys(changes)) {
    if (key === 'title') {
      const title = sections.flatMap((s) => s.profileElements ?? []).find((e) => e.elementKey === 'title')
      if (title?.elementId) ids.add(title.elementId)
    } else if (key.startsWith('Pe')) {
      ids.add(key.split('.')[0])
    }
  }
  return ids
}

/**
 * The `elements` users.profile.setSections takes for one section: every
 * element in it, as Slack's form sends them (empty ones as null), with the
 * changes applied.
 */
export function sectionElements(section: RawSection, changes: SlackProfile): object[] {
  const out: object[] = []
  for (const e of section.profileElements ?? []) {
    const id = e.elementId
    if (!id) continue
    // Only new values are tidied: untouched ones go back exactly as Slack has them.
    const pick = (key: string, current: string | null | undefined) => (key in changes ? changes[key].trim() : (current ?? ''))
    switch (e.__typename) {
      case 'ProfileTextElement': {
        const text = pick(e.elementKey === 'title' ? 'title' : id, e.text)
        out.push({ element_id: id, text: text ? { text } : null })
        break
      }
      case 'ProfileDateElement': {
        const date = pick(id, e.date)
        out.push({ element_id: id, date: date ? { date } : null })
        break
      }
      case 'ProfileLinkElement': {
        const displayText = pick(`${id}.text`, e.displayText)
        const uri = pick(`${id}.url`, e.uri)
        out.push({ element_id: id, link: uri ? { displayText, uri } : null })
        break
      }
      case 'ProfilePersonElement': {
        if (e.isScimManaged) break
        const persons = id in changes ? changes[id].split(',').map((p) => p.trim()).filter(Boolean) : personIds(e)
        out.push({ element_id: id, person: { persons } })
        break
      }
      case 'ProfileFileElement':
        out.push({ element_id: id, file: e.fileId ? { fileId: e.fileId } : null })
        break
      case 'ProfileLongTextElement':
        out.push({ element_id: id, long_text: { blocks: e.blocks ?? '' } })
        break
      case 'ProfileTagsElement':
        out.push({ element_id: id, tags: { tags: e.tags ?? [] } })
        break
      case 'ProfileCurrentLocationElement':
        out.push({
          element_id: id,
          currentLocation: { city: e.city ?? '', country: e.country ?? '', description: e.description ?? '', state: e.state ?? '' }
        })
        break
      default:
        // Leaving an element out of a section save would clear it.
        throw new UnknownElementError(e.label || id)
    }
  }
  return out
}

/** A section holds an element HAM doesn't know how to send back. */
export class UnknownElementError extends Error {
  constructor(label: string) {
    super(`HAM can’t save this part of the Slack profile yet (it has a “${label}” field HAM doesn’t know).`)
  }
}

/** User ids named in people fields, to look up their names. */
export function referencedUsers(fields: SlackFieldDef[], values: SlackProfile): string[] {
  const ids = new Set<string>()
  for (const f of fields) if (f.kind === 'person') for (const id of (values[f.id] ?? '').split(',')) if (id) ids.add(id)
  return [...ids]
}

/** A sentence for a Slack API error code. */
export function slackErrorMessage(code: string): string {
  if (/not_valid_emoji/.test(code)) return 'Slack doesn’t know that status emoji.'
  if (/^invalid_name/.test(code) || code === 'name_not_allowed') return 'Slack doesn’t allow that name.'
  if (code === 'ratelimited') return 'Slack is rate limiting this account. Try again in a minute.'
  if (code === 'failed_to_set_sections') return 'Slack didn’t accept those field values.'
  if (code === 'invalid_timezone' || code === 'invalid_tz') return 'Slack doesn’t know that timezone.'
  return `Slack said “${code.replace(/_/g, ' ')}”.`
}
