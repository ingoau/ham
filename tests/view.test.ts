import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, type Account } from '../src/shared/types'
import { badgeFor, buildView, sortDirLabel, statusText } from '../src/renderer/src/view'

const NOW = Date.parse('2026-11-23T12:00:00Z')
let n = 0
function acct(p: Partial<Account>): Account {
  n++
  return {
    id: `a${n}`,
    email: `user${n}@example.com`,
    firstName: 'Fiona',
    lastName: `Hack${n}`,
    phone: '',
    hasLegalName: false,
    status: 'signed-in',
    fresh: false,
    pinned: false,
    expiresAt: null,
    addedAt: new Date(NOW - (100 - n) * 1000).toISOString(),
    pending: null,
    slack: { linked: null, session: false, profile: {} },
    ...p
  }
}
const noTpl = { line1: new Map(), line2: new Map(), group: new Map() }

describe('statusText and badges', () => {
  it('counts down the 15-minute attempt', () => {
    const a = acct({ status: 'waiting', fresh: true, pending: { startedAt: new Date(NOW - 60_000).toISOString(), startsAt: null, autoCode: null, second: 'totp', message: null, expired: false } })
    expect(statusText(a, false, NOW)).toBe('Enter the emailed code · 14:00')
    expect(statusText(a, true, NOW)).toBe('Waiting for the email…')
    expect(badgeFor(a, false)?.label).toBe('Code')
    expect(badgeFor(a, true)?.label).toBe('Auto code')
  })
  it('shows queue starts', () => {
    const a = acct({ status: 'queued', fresh: true, pending: { startedAt: null, startsAt: new Date(NOW + 95_000).toISOString(), autoCode: null, second: 'totp', message: null, expired: false } })
    expect(statusText(a, false, NOW)).toBe('Starts in 1:35')
  })
})

describe('buildView', () => {
  it('shows pending accounts by email and sorts', () => {
    const a = acct({ firstName: 'Zed' })
    const b = acct({ firstName: 'Amy' })
    const c = acct({ status: 'sending', fresh: true, email: 'new@example.com', firstName: '', lastName: '' })
    const v = buildView([a, b, c], DEFAULT_VIEW, noTpl, false, NOW)
    expect(v.groups[0].rows.map((r) => r.title)).toEqual([`Amy Hack${b.id.slice(1)}`, 'new@example.com', `Zed Hack${a.id.slice(1)}`])
  })
  it('groups by status in a fixed order and skips collapsed groups in the visible order', () => {
    const ok = acct({})
    const out = acct({ status: 'signed-out' })
    const bad = acct({ status: 'failed', fresh: true })
    const view = { ...DEFAULT_VIEW, groupBy: 'status' as const, collapsed: { 'status:Signed out': true } }
    const v = buildView([ok, out, bad], view, noTpl, false, NOW)
    expect(v.groups.map((g) => g.name)).toEqual(['Needs attention', 'Signed out', 'Signed in'])
    expect(v.order).toEqual([bad.id, ok.id])
  })
  it('puts pinned accounts first and keeps manual order', () => {
    const a = acct({ firstName: 'Zed' })
    const b = acct({ firstName: 'Amy', pinned: true })
    const c = acct({ firstName: 'Bob' })
    const v = buildView([a, b, c], { ...DEFAULT_VIEW, sortBy: 'manual' }, noTpl, false, NOW)
    expect(v.groups.map((g) => g.name)).toEqual(['Pinned', 'Accounts'])
    expect(v.order).toEqual([b.id, a.id, c.id])
    expect(v.draggable).toBe(true)
  })
  it('labels sort directions', () => {
    expect(sortDirLabel({ ...DEFAULT_VIEW, sortBy: 'added', sortDir: 'desc' })).toBe('Newest first')
    expect(sortDirLabel({ ...DEFAULT_VIEW, sortBy: 'status', sortDir: 'asc' })).toBe('Attention first')
  })
})
