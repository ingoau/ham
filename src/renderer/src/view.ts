// Turns accounts + view settings into the sidebar's rows: what each row says,
// the sort order, and grouping. Template values are rendered separately (in
// the sandbox) and passed in by account id.
import { isPending, type Account, type LineKind, type ViewSettings } from '@shared/types'
import { displayName } from './util'

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
}

export interface TemplateValues {
  line1: Map<string, string>
  line2: Map<string, string>
  group: Map<string, string>
}

export function buildView(accounts: Account[], view: ViewSettings, tv: TemplateValues, inboxOn: boolean, now: number) {
  const titleOf = (a: Account) => (a.fresh && isPending(a.status) ? a.email : lineValue(a, view.line1, tv.line1.get(a.id)))
  const subOf = (a: Account) =>
    a.status === 'signed-in' || a.status === 'signed-out' ? lineValue(a, view.line2, tv.line2.get(a.id)) : statusText(a, inboxOn, now)

  const key = (a: Account): string | number => {
    switch (view.sortBy) {
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
  const dir = view.sortDir === 'desc' ? -1 : 1
  const sorted = [...accounts].sort((x, y) => {
    const kx = key(x)
    const ky = key(y)
    const c = kx < ky ? -1 : kx > ky ? 1 : 0
    return c * dir || x.addedAt.localeCompare(y.addedAt)
  })

  const groupOf = (a: Account): string => {
    switch (view.groupBy) {
      case 'status':
        if (a.status === 'signed-in') return 'Signed in'
        if (a.status === 'signed-out') return 'Signed out'
        if (a.status === 'failed' || a.status === 'stuck' || a.status === 'needs2fa') return 'Needs attention'
        return 'Adding'
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

  const groups: GroupModel[] = []
  if (view.groupBy === 'none') {
    groups.push({ name: '', key: '', open: true, rows: sorted.map((a) => ({ account: a, title: titleOf(a), sub: subOf(a) })) })
  } else {
    const byName = new Map<string, GroupModel>()
    for (const a of sorted) {
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
  // Visible order for shift-click ranges: skips collapsed groups.
  const order = groups.flatMap((g) => (g.open ? g.rows.map((r) => r.account.id) : []))
  return { groups, order, showSub: view.line2 !== 'none' }
}

export function sortDirLabel(view: ViewSettings): string {
  if (view.sortBy === 'added') return view.sortDir === 'desc' ? 'Newest first' : 'Oldest first'
  if (view.sortBy === 'status') return view.sortDir === 'desc' ? 'Attention last' : 'Attention first'
  return view.sortDir === 'desc' ? 'Z–A' : 'A–Z'
}
