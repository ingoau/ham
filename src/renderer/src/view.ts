// Turns accounts + view settings into the sidebar's rows: what each row says,
// the sort order, and grouping. Template values are rendered separately (in
// the sandbox) and passed in by account id.
import { isPending, NO_TAGS, type Account, type AccountFilter, type AccountGroup, type LineKind, type StatusFilter, type ViewSettings } from '@shared/types'
import { accountName, bestName, displayName } from './util'

export const ATTEMPT_MS = 15 * 60 * 1000

export function mmss(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export function attemptLeft(a: Account, now: number): number {
  const started = a.pending?.startedAt ? Date.parse(a.pending.startedAt) : now
  // The renderer's clock may lag the moment the attempt started by a tick.
  return Math.min(ATTEMPT_MS, started + ATTEMPT_MS - now)
}

export type Tone = 'warn' | 'info' | 'ok' | 'violet' | 'neutral' | 'danger'

export function badgeFor(a: Account, inboxOn: boolean): { label: string; tone: Tone } | null {
  switch (a.status) {
    case 'signed-out':
      return { label: 'Signed out', tone: 'warn' }
    case 'sending':
    case 'waiting':
      return inboxOn || a.pending?.autoCode ? { label: 'Auto code', tone: 'ok' } : { label: 'Code', tone: 'info' }
    case 'needs2fa':
      return { label: '2FA', tone: 'violet' }
    case 'queued':
      return { label: 'Queued', tone: 'neutral' }
    case 'failed':
    case 'stuck':
      return { label: 'Fix', tone: 'danger' }
    default:
      return null
  }
}

/** The second line for an account that's still being added. */
export function statusText(a: Account, inboxOn: boolean, now: number): string {
  const p = a.pending
  switch (a.status) {
    case 'sending':
      return 'Sending code…'
    case 'waiting':
      if (p?.autoCode) return 'Code found, signing in…'
      if (p?.expired && !inboxOn) return 'Code expired'
      return inboxOn ? 'Waiting for the email…' : `Enter the emailed code · ${mmss(attemptLeft(a, now))}`
    case 'needs2fa':
      if (p?.expired && !inboxOn) return 'Sign-in expired'
      return `2FA code needed · ${mmss(attemptLeft(a, now))}`
    case 'queued':
      return p?.startsAt && Date.parse(p.startsAt) > now ? `Starts in ${mmss(Date.parse(p.startsAt) - now)}` : 'Starting…'
    case 'failed':
      return p?.message === 'no-account' ? 'No account for this email' : 'Couldn’t sign in'
    case 'stuck':
      return 'Needs a passkey'
    default:
      return a.email
  }
}

export function lineValue(a: Account, kind: LineKind, tplValue: string | undefined): string {
  const hca = displayName(a)
  const sl = a.slack.profile
  switch (kind) {
    case 'email':
      return a.email
    case 'best':
      return bestName(a)
    case 'local':
      return accountName(a)
    case 'sfull':
      return sl.real_name || hca
    case 'sdisplay':
      return sl.display_name || hca
    case 'none':
      return ''
    case 'tpl':
      return tplValue ?? hca
    default:
      return hca
  }
}

const STATUS_RANK: Record<Account['status'], number> = {
  failed: 0,
  stuck: 0,
  needs2fa: 1,
  waiting: 2,
  sending: 2,
  queued: 3,
  'signed-out': 4,
  'signed-in': 5
}

const GROUP_ORDER: Record<string, number> = {
  'Needs attention': 0,
  Adding: 1,
  'Signed out': 2,
  'Signed in': 3,
  'On Slack': 0,
  'Not on Slack': 1
}

export function statusBucket(a: Account): StatusFilter {
  if (a.status === 'signed-in') return 'signed-in'
  if (a.status === 'signed-out') return 'signed-out'
  if (a.status === 'failed' || a.status === 'stuck' || a.status === 'needs2fa') return 'attention'
  return 'adding'
}

export const STATUS_FILTERS: [StatusFilter, string][] = [
  ['signed-in', 'Signed in'],
  ['signed-out', 'Signed out'],
  ['attention', 'Needs attention'],
  ['adding', 'Adding']
]

/** How many filter options are on. Tags that no longer exist don't count. */
export const filterCount = (f: AccountFilter, knownTags?: Set<string>) =>
  f.tags.filter((t) => t === NO_TAGS || !knownTags || knownTags.has(t)).length + f.status.length
export const filterActive = (f: AccountFilter, knownTags?: Set<string>) => filterCount(f, knownTags) > 0

/** Whether an account passes the sidebar filter. Tags that no longer exist are ignored. */
export function matchesFilter(a: Account, f: AccountFilter, knownTags?: Set<string>): boolean {
  if (f.status.length && !f.status.includes(statusBucket(a))) return false
  const own = knownTags ? a.tagIds.filter((t) => knownTags.has(t)) : a.tagIds
  const wanted = f.tags.filter((t) => t !== NO_TAGS && (!knownTags || knownTags.has(t)))
  const untagged = f.tags.includes(NO_TAGS)
  if (!wanted.length && !untagged) return true
  if (untagged && own.length === 0) return true
  if (!wanted.length) return false
  return f.tagMode === 'all' ? wanted.every((t) => own.includes(t)) : wanted.some((t) => own.includes(t))
}

export interface RowModel {
  account: Account
  title: string
  sub: string
}

export interface GroupModel {
  name: string
  key: string
  open: boolean
  rows: RowModel[]
  /** The Pinned section, always first. */
  pinned?: boolean
  /** With your own groups: the group's id, or null for the ungrouped section. */
  groupId?: string | null
}

export interface TemplateValues {
  line1: Map<string, string>
  line2: Map<string, string>
  group: Map<string, string>
}

export function buildView(
  accounts: Account[],
  view: ViewSettings,
  tv: TemplateValues,
  inboxOn: boolean,
  now: number,
  userGroups: AccountGroup[] = [],
  knownTags?: Set<string>
) {
  const filtering = filterActive(view.filter, knownTags)
  const total = accounts.length
  if (filtering) accounts = accounts.filter((a) => matchesFilter(a, view.filter, knownTags))
  const titleOf = (a: Account) => (a.fresh && isPending(a.status) ? a.email : lineValue(a, view.line1, tv.line1.get(a.id)))
  const subOf = (a: Account) => {
    if (a.status !== 'signed-in' && a.status !== 'signed-out') return statusText(a, inboxOn, now)
    const sub = lineValue(a, view.line2, tv.line2.get(a.id))
    // A line that falls back to the same text as the first (no local name, say) shows the email instead.
    return sub === titleOf(a) && view.line2 !== view.line1 ? a.email : sub
  }

  const position = new Map(accounts.map((a, i) => [a.id, i]))
  const key = (a: Account): string | number => {
    switch (view.sortBy) {
      case 'manual':
        return position.get(a.id) ?? 0
      case 'email':
        return a.email
      case 'sdisplay':
        return (a.slack.profile.display_name || displayName(a)).toLowerCase()
      case 'added':
        return Date.parse(a.addedAt) || 0
      case 'status':
        return STATUS_RANK[a.status]
      case 'line1':
        return titleOf(a).toLowerCase()
      default:
        return `${displayName(a)} ${a.email}`.toLowerCase()
    }
  }
  const dir = view.sortDir === 'desc' && view.sortBy !== 'manual' ? -1 : 1
  const sorted = [...accounts].sort((x, y) => {
    const kx = key(x)
    const ky = key(y)
    const c = kx < ky ? -1 : kx > ky ? 1 : 0
    return c * dir || x.addedAt.localeCompare(y.addedAt)
  })

  const groupOf = (a: Account): string => {
    switch (view.groupBy) {
      case 'status':
        return STATUS_FILTERS.find(([k]) => k === statusBucket(a))![1]
      case 'domain':
        return a.email.split('@')[1] ?? ''
      case 'slack':
        return a.slack.linked ? 'On Slack' : 'Not on Slack'
      case 'tpl': {
        const v = tv.group.get(a.id)
        return v === undefined ? '…' : v.trim() || '(empty)'
      }
      default:
        return ''
    }
  }

  const row = (a: Account): RowModel => ({ account: a, title: titleOf(a), sub: subOf(a) })
  const pinned = sorted.filter((a) => a.pinned)
  const others = sorted.filter((a) => !a.pinned)
  const groups: GroupModel[] = []
  if (view.groupBy === 'none') {
    // Your own groups, in your order, then everything else.
    for (const ug of userGroups) {
      const gkey = `group:${ug.id}`
      groups.push({ name: ug.name, key: gkey, open: !view.collapsed[gkey], rows: others.filter((a) => a.groupId === ug.id).map(row), groupId: ug.id })
    }
    const known = new Set(userGroups.map((g) => g.id))
    const loose = others.filter((a) => !a.groupId || !known.has(a.groupId))
    const sectioned = pinned.length > 0 || userGroups.length > 0
    groups.push({
      name: !sectioned ? '' : userGroups.length ? 'Ungrouped' : 'Accounts',
      key: '',
      open: sectioned ? !view.collapsed['accounts'] : true,
      rows: loose.map(row),
      groupId: null
    })
  } else {
    const byName = new Map<string, GroupModel>()
    for (const a of others) {
      const name = groupOf(a)
      let g = byName.get(name)
      if (!g) {
        const gkey = `${view.groupBy}:${name}`
        g = { name, key: gkey, open: !view.collapsed[gkey], rows: [] }
        byName.set(name, g)
        groups.push(g)
      }
      g.rows.push({ account: a, title: titleOf(a), sub: subOf(a) })
    }
    const rank = (n: string) => GROUP_ORDER[n] ?? 50
    groups.sort((x, y) => rank(x.name) - rank(y.name) || x.name.localeCompare(y.name))
  }
  if (pinned.length) groups.unshift({ name: 'Pinned', key: 'pinned', open: !view.collapsed['pinned'], rows: pinned.map(row), pinned: true })
  // Visible order for shift-click ranges: skips collapsed groups.
  const order = groups.flatMap((g) => (g.open ? g.rows.map((r) => r.account.id) : []))
  // Every account the filter lets through, collapsed or not (for Select All).
  const visible = groups.flatMap((g) => g.rows.map((r) => r.account.id))
  return {
    groups,
    order,
    visible,
    total,
    filtering,
    showSub: view.line2 !== 'none',
    // A manual order can't be saved from a filtered list (hidden accounts have places too).
    draggable: view.groupBy === 'none' && !filtering
  }
}

export function sortDirLabel(view: ViewSettings): string {
  if (view.sortBy === 'manual') return ''
  if (view.sortBy === 'added') return view.sortDir === 'desc' ? 'Newest first' : 'Oldest first'
  if (view.sortBy === 'status') return view.sortDir === 'desc' ? 'Attention last' : 'Attention first'
  return view.sortDir === 'desc' ? 'Z–A' : 'A–Z'
}
