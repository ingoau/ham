// The fields bulk edit can change, the template context, and value checks.
import type { Account } from './types'

export const GROUP_HAM = 'HAM'
export const GROUP_HCA = 'Hack Club Auth'
export const GROUP_SLACK = 'Slack profile'
export const GROUP_SLACK_CUSTOM = 'Slack custom fields'
export const FIELD_GROUPS = [GROUP_HAM, GROUP_HCA, GROUP_SLACK, GROUP_SLACK_CUSTOM] as const

export type FieldKind = 'text' | 'date' | 'tz' | 'emoji' | 'url'

export interface FieldDef {
  id: string
  name: string
  group: (typeof FIELD_GROUPS)[number]
  /** Key in the template's `account` object. */
  key: string
  kind: FieldKind
  required?: boolean
  /** Hack Club Auth fields save through the account's profile. */
  hca?: boolean
  /** Kept in HAM only (the local name): no server, works signed out. */
  local?: boolean
  /** Admin-only on Slack: shown, never editable. */
  locked?: boolean
}

const f = (id: string, name: string, group: FieldDef['group'], extra: Partial<FieldDef> = {}): FieldDef => ({
  id,
  name,
  group,
  key: id,
  kind: 'text',
  ...extra
})

export const HAM_FIELDS: FieldDef[] = [f('local', 'Local name', GROUP_HAM, { local: true })]

export const HCA_FIELDS: FieldDef[] = [
  f('first', 'First name', GROUP_HCA, { hca: true, required: true }),
  f('last', 'Last name', GROUP_HCA, { hca: true, required: true }),
  f('phone', 'Phone number', GROUP_HCA, { hca: true })
]

export const SLACK_PROFILE_FIELDS: FieldDef[] = [
  f('real_name', 'Full name', GROUP_SLACK, { required: true }),
  f('display_name', 'Display name', GROUP_SLACK),
  f('title', 'Title', GROUP_SLACK),
  f('pronouns', 'Pronouns', GROUP_SLACK),
  f('pronunciation', 'Name pronunciation', GROUP_SLACK),
  f('tz', 'Timezone', GROUP_SLACK, { kind: 'tz' }),
  f('status_emoji', 'Status emoji', GROUP_SLACK, { kind: 'emoji' }),
  f('status_text', 'Status text', GROUP_SLACK)
]

/**
 * Hack Club Slack's custom profile fields as of 2026-11. Once the Slack
 * integration exists this list comes from team.profile.get instead.
 */
export const SLACK_CUSTOM_FIELDS: FieldDef[] = [
  f('start_date', 'Start date', GROUP_SLACK_CUSTOM, { kind: 'date' }),
  f('website_text', 'Website: display text', GROUP_SLACK_CUSTOM),
  f('website_url', 'Website: URL', GROUP_SLACK_CUSTOM, { kind: 'url' }),
  f('scrapbook_text', 'Scrapbook: display text', GROUP_SLACK_CUSTOM),
  f('scrapbook_url', 'Scrapbook: URL', GROUP_SLACK_CUSTOM, { kind: 'url' }),
  f('github_text', 'GitHub: display text', GROUP_SLACK_CUSTOM),
  f('github_url', 'GitHub: URL', GROUP_SLACK_CUSTOM, { kind: 'url' }),
  f('school', 'School', GROUP_SLACK_CUSTOM),
  f('birthday', 'Birthday', GROUP_SLACK_CUSTOM, { kind: 'date' }),
  f('fav_channels', 'Favorite channel(s)', GROUP_SLACK_CUSTOM),
  f('fav_food', 'Fav food(s)', GROUP_SLACK_CUSTOM),
  f('fav_bands', 'Fav band/artist(s)', GROUP_SLACK_CUSTOM),
  f('location', 'Location', GROUP_SLACK_CUSTOM),
  f('fav_activities', 'Fav activities', GROUP_SLACK_CUSTOM),
  f('fav_tools', 'Fav languages/tools', GROUP_SLACK_CUSTOM),
  f('dog_cat', 'Dog or cat or infrastructure?', GROUP_SLACK_CUSTOM),
  f('ham_callsign', 'Ham callsign (or other unusual way to contact me)', GROUP_SLACK_CUSTOM),
  f('pfp_credit', 'PFP credit', GROUP_SLACK_CUSTOM),
  f('gold_since', 'Hack Club Gold since', GROUP_SLACK_CUSTOM, { locked: true }),
  f('social_text', 'Social account: display text', GROUP_SLACK_CUSTOM),
  f('social_url', 'Social account: URL', GROUP_SLACK_CUSTOM, { kind: 'url' }),
  f('fandoms', 'Fandoms', GROUP_SLACK_CUSTOM),
  f('fav_emoji', 'Favorite emoji', GROUP_SLACK_CUSTOM, { kind: 'emoji' })
]

export const ALL_FIELDS: FieldDef[] = [...HAM_FIELDS, ...HCA_FIELDS, ...SLACK_PROFILE_FIELDS, ...SLACK_CUSTOM_FIELDS]

/** Slack writes need the Slack API integration, which hasn't landed yet. */
export const SLACK_WRITES_AVAILABLE = false

export function fieldEditable(field: FieldDef): boolean {
  if (field.locked) return false
  return field.hca === true || field.local === true || SLACK_WRITES_AVAILABLE
}

export function fieldValue(a: Account, field: FieldDef): string {
  if (field.local) return a.localName
  if (field.hca) {
    if (field.key === 'first') return a.firstName
    if (field.key === 'last') return a.lastName
    if (field.key === 'phone') return a.phone
  }
  return a.slack.profile[field.key] ?? ''
}

/** The `account` object templates see. */
export interface TemplateAccount {
  /** The local name, or '' when there isn't one. */
  local: string
  first: string
  last: string
  email: string
  phone: string
  [slackKey: string]: string
}

export function templateAccount(a: Account | null): TemplateAccount {
  const acct: TemplateAccount = { local: '', first: '', last: '', email: '', phone: '' }
  for (const fd of [...SLACK_PROFILE_FIELDS, ...SLACK_CUSTOM_FIELDS]) acct[fd.key] = ''
  if (!a) return acct
  acct.local = a.localName
  acct.first = a.firstName
  acct.last = a.lastName
  acct.email = a.email
  acct.phone = a.phone
  for (const [k, v] of Object.entries(a.slack.profile)) acct[k] = v
  return acct
}

export interface TemplateContext {
  index: number
  total: number
  current: string
  account: TemplateAccount
}

export function isValidTimezone(v: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v })
    return true
  } catch {
    return false
  }
}

/** A problem with a value for a field, or '' when it's fine. */
export function checkValue(field: FieldDef, value: string): string {
  if (field.required && !value.trim()) return "Can't be blank"
  if (!value) return ''
  if (field.local && value.length > 60) return 'Keep it under 60 characters'
  switch (field.kind) {
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? '' : 'Use YYYY-MM-DD'
    case 'tz':
      return isValidTimezone(value) ? '' : 'Unknown timezone'
    case 'emoji':
      return /^:[a-z0-9_+-]+:$/.test(value) ? '' : 'Use :emoji_name:'
    case 'url':
      return /^https:\/\/\S+$/.test(value) ? '' : 'Must start with https://'
    default:
      return ''
  }
}
