// The fields bulk edit can change, the template context, and value checks.
// Hack Club Auth and the standard Slack fields are fixed; the workspace's own
// Slack fields come from Slack (see SlackFieldDef) and change with it.
import type { Account, SlackFieldDef } from './types'

export const GROUP_HAM = 'HAM'
export const GROUP_HCA = 'Hack Club Auth'
export const GROUP_SLACK = 'Slack profile'
export const GROUP_SLACK_CUSTOM = 'Slack custom fields'
export const FIELD_GROUPS = [GROUP_HAM, GROUP_HCA, GROUP_SLACK, GROUP_SLACK_CUSTOM] as const

export type FieldKind = 'text' | 'date' | 'tz' | 'emoji' | 'url' | 'user' | 'datetime'

export interface FieldDef {
  /** Where the value lives: SlackProfile key for Slack fields. */
  id: string
  name: string
  group: (typeof FIELD_GROUPS)[number]
  /** Key in the template's `account` object, under its group (see templatePath). */
  key: string
  kind: FieldKind
  required?: boolean
  /** Hack Club Auth fields save through the account's profile. */
  hca?: boolean
  /** Kept in HAM only (the local name): no server, works signed out. */
  local?: boolean
  /** Admin-only on Slack: shown, never editable. */
  locked?: boolean
  /** Slack's hint for the field. */
  hint?: string
  /** For the workspace's own Slack fields: the field it came from. */
  slack?: SlackFieldDef
  /** Which half of a Slack link field this is. */
  part?: 'text' | 'url'
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

/** Fields every Slack profile has, whatever the workspace adds. */
export const SLACK_PROFILE_FIELDS: FieldDef[] = [
  f('real_name', 'Full name', GROUP_SLACK, { required: true }),
  f('display_name', 'Display name', GROUP_SLACK),
  f('title', 'Title', GROUP_SLACK),
  f('pronouns', 'Pronouns', GROUP_SLACK),
  f('tz', 'Timezone', GROUP_SLACK, { kind: 'tz' }),
  f('status_emoji', 'Status emoji', GROUP_SLACK, { kind: 'emoji' }),
  f('status_text', 'Status text', GROUP_SLACK),
  // An ISO time ("2026-11-24T06:00:00Z"), or empty to keep the status until it's changed.
  f('status_expiration', 'Clear status after', GROUP_SLACK, { kind: 'datetime' })
]

/** The fixed fields: everything but the workspace's own Slack fields. */
export const FIXED_FIELDS: FieldDef[] = [...HAM_FIELDS, ...HCA_FIELDS, ...SLACK_PROFILE_FIELDS]

/** Bulk-edit fields for the workspace's own Slack fields. A link field becomes two: its text and its URL. */
export function slackCustomFields(schema: readonly SlackFieldDef[]): FieldDef[] {
  const out: FieldDef[] = []
  for (const sf of schema) {
    const base = { slack: sf, locked: !sf.editable, hint: sf.hint || undefined }
    if (sf.kind === 'link') {
      out.push(f(`${sf.id}.text`, `${sf.label}: display text`, GROUP_SLACK_CUSTOM, { ...base, key: `${sf.key}_text`, part: 'text' }))
      out.push(f(`${sf.id}.url`, `${sf.label}: URL`, GROUP_SLACK_CUSTOM, { ...base, key: `${sf.key}_url`, kind: 'url', part: 'url' }))
    } else {
      const kind: FieldKind = sf.kind === 'date' ? 'date' : sf.kind === 'person' ? 'user' : 'text'
      out.push(f(sf.id, sf.label, GROUP_SLACK_CUSTOM, { ...base, key: sf.key, kind }))
    }
  }
  return out
}

/** Every field, with the workspace's own Slack fields from `schema`. */
export function allFields(schema: readonly SlackFieldDef[]): FieldDef[] {
  return [...FIXED_FIELDS, ...slackCustomFields(schema)]
}

/** A template key for a Slack field label: "Fav Food(s)" → "fav_food_s". */
export function slugKey(label: string, fallback: string): string {
  const slug = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!slug) return fallback.toLowerCase()
  return /^\d/.test(slug) ? `f_${slug}` : slug
}

export function fieldEditable(field: FieldDef): boolean {
  return !field.locked
}

export function isSlackField(field: FieldDef): boolean {
  return field.group === GROUP_SLACK || field.group === GROUP_SLACK_CUSTOM
}

export function fieldValue(a: Account, field: FieldDef): string {
  if (field.local) return a.localName
  if (field.hca) {
    if (field.key === 'first') return a.firstName
    if (field.key === 'last') return a.lastName
    if (field.key === 'phone') return a.phone
  }
  return a.slack.profile[field.id] ?? ''
}

/** The `account` object templates see. */
export interface TemplateAccount {
  /** The local name, or '' when there isn't one. */
  local: string
  email: string
  hca: { first: string; last: string; phone: string }
  /** Slack profile fields and the Slack user id, with the workspace's own fields under `fields`. */
  slack: { id: string; fields: Record<string, string>; [key: string]: string | Record<string, string> }
}

/** Where a field sits in the template's `account` object, e.g. "slack.fields.school". */
export function templatePath(field: FieldDef): string {
  if (field.group === GROUP_HAM) return field.key
  if (field.group === GROUP_HCA) return `hca.${field.key}`
  if (field.group === GROUP_SLACK) return `slack.${field.key}`
  return `slack.fields.${field.key}`
}

/** The template context's `account`, with `custom` from slackCustomFields(). */
export function templateAccount(a: Account | null, custom: readonly FieldDef[]): TemplateAccount {
  const fields: Record<string, string> = {}
  const slack: TemplateAccount['slack'] = { id: a?.slack.id ?? '', fields }
  for (const fd of SLACK_PROFILE_FIELDS) slack[fd.key] = a?.slack.profile[fd.id] ?? ''
  for (const fd of custom) fields[fd.key] = a ? fieldValue(a, fd) : ''
  return {
    local: a?.localName ?? '',
    email: a?.email ?? '',
    hca: { first: a?.firstName ?? '', last: a?.lastName ?? '', phone: a?.phone ?? '' },
    slack
  }
}

/** Rewrite templates saved before fields moved under account.hca / account.slack. */
export function migrateTemplate(tpl: string): string {
  return tpl.replace(/\baccount\.(\w+)\b/g, (whole, key: string) => {
    const field = FIXED_FIELDS.find((fd) => fd.key === key && fd.group !== GROUP_HAM)
    return field ? `account.${templatePath(field)}` : whole
  })
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
      return /^https?:\/\/\S+$/.test(value) ? '' : 'Must start with https://'
    case 'datetime': {
      const ms = Date.parse(value)
      if (Number.isNaN(ms)) return 'Use a date and time, e.g. 2026-11-24 17:00'
      return ms > Date.now() ? '' : 'That time has passed'
    }
    case 'user':
      return value.split(',').every((id) => /^[UW][A-Z0-9]{2,}$/.test(id.trim())) ? '' : 'Use Slack user IDs (U…), separated by commas'
    default:
      return ''
  }
}
