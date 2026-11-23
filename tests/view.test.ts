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
    localName: '',
    firstName: 'Fiona',
    lastName: `Hack${n}`,
    phone: '',
    hasLegalName: false,
    status: 'signed-in',
    fresh: false,
    pinned: false,
    groupId: null,
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
  it('shows your groups in order, including empty ones, then ungrouped', () => {
    const a = acct({ firstName: 'Zed', groupId: 'g2' })
    const b = acct({ firstName: 'Amy' })
    const c = acct({ firstName: 'Bob', groupId: 'gone' })
    const d = acct({ firstName: 'Cat', groupId: 'g2', pinned: true })
    const groups = [
      { id: 'g1', name: 'Empty' },
      { id: 'g2', name: 'Clubs' }
    ]
    const v = buildView([a, b, c, d], { ...DEFAULT_VIEW, sortBy: 'manual' }, noTpl, false, NOW, groups)
    expect(v.groups.map((g) => [g.name, g.rows.length])).toEqual([
      ['Pinned', 1],
      ['Empty', 0],
      ['Clubs', 1],
      ['Ungrouped', 2]
    ])
    expect(v.order).toEqual([d.id, a.id, b.id, c.id])
    // Automatic grouping hides your groups.
    const byStatus = buildView([a, b], { ...DEFAULT_VIEW, groupBy: 'status' }, noTpl, false, NOW, groups)
    expect(byStatus.groups.map((g) => g.name)).toEqual(['Signed in'])
  })
  it('picks the best name: local, Slack display, Slack full, then Hack Club', () => {
    const local = acct({ localName: 'Main', slack: { linked: true, session: true, profile: { display_name: 'disp', real_name: 'Real' } } })
    const disp = acct({ slack: { linked: true, session: true, profile: { display_name: 'disp2', real_name: 'Real' } } })
    const full = acct({ slack: { linked: true, session: true, profile: { display_name: '', real_name: 'Real3' } } })
    const hca = acct({ firstName: 'Amy' })
    const v = buildView([local, disp, full, hca], { ...DEFAULT_VIEW, sortBy: 'manual' }, noTpl, false, NOW)
    expect(v.groups[0].rows.map((r) => r.title)).toEqual(['Main', 'disp2', 'Real3', `Amy Hack${hca.id.slice(1)}`])
    const hcaOnly = buildView([local], { ...DEFAULT_VIEW, line1: 'hca' }, noTpl, false, NOW)
    expect(hcaOnly.groups[0].rows[0].title).toBe(`Fiona Hack${local.id.slice(1)}`)
  })
  it('shows local names, falling back to the Hack Club name', () => {
    const a = acct({ firstName: 'Zed', localName: 'Main' })
    const b = acct({ firstName: 'Amy' })
    const local = buildView([a, b], { ...DEFAULT_VIEW, line1: 'local', line2: 'hca' }, noTpl, false, NOW)
    // Falls back to the Hack Club name, and sorts by what's shown.
    expect(local.groups[0].rows.map((r) => [r.title, r.sub])).toEqual([
      [`Amy Hack${b.id.slice(1)}`, b.email],
      ['Main', `Zed Hack${a.id.slice(1)}`]
    ])
  })
  it('labels sort directions', () => {
    expect(sortDirLabel({ ...DEFAULT_VIEW, sortBy: 'added', sortDir: 'desc' })).toBe('Newest first')
    expect(sortDirLabel({ ...DEFAULT_VIEW, sortBy: 'status', sortDir: 'asc' })).toBe('Attention first')
  })
})
