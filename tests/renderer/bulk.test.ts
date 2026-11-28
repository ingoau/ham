import { describe, expect, it } from 'vitest'
import { FIXED_FIELDS, type FieldDef } from '../../src/shared/fields'
import { bulkJobs, contextFor, emptyContext, planBulk, skipReason } from '../../src/renderer/src/bulk'
import { acct } from './helpers'

const field = (id: string): FieldDef => FIXED_FIELDS.find((f) => f.id === id)!
const first = field('first')
const local = field('local')
const pronouns = field('pronouns')

describe('skipReason', () => {
  it('needs a Hack Club session for Hack Club fields', () => {
    expect(skipReason(acct(), first)).toBeNull()
    expect(skipReason(acct({ status: 'signed-out' }), first)).toBe('Not signed in')
    expect(skipReason(acct({ status: 'waiting' }), first)).toBe('Not signed in')
  })
  it('lets local fields through whatever the status', () => {
    expect(skipReason(acct({ status: 'signed-out' }), local)).toBeNull()
  })
  it('needs a read Slack session for Slack fields', () => {
    expect(skipReason(acct({ slack: { linked: false, session: false, profile: {} } }), pronouns)).toBe('Not on Slack')
    expect(skipReason(acct({ slack: { linked: true, session: false, profile: {} } }), pronouns)).toBe('Open Slack first')
    expect(skipReason(acct({ slack: { linked: true, session: true, profile: {} } }), pronouns)).toBe('Refresh first')
    expect(skipReason(acct({ slack: { linked: true, session: true, profile: {}, fetchedAt: '2026-11-01T00:00:00Z' } }), pronouns)).toBeNull()
  })
})

describe('bulkJobs', () => {
  it('numbers only the accounts the field applies to', () => {
    const a = acct({ firstName: 'Ann' })
    const out = acct({ status: 'signed-out' })
    const b = acct({ firstName: 'Bo' })
    const { targets, jobs } = bulkJobs([a, out, b], first, '{{ index }}', [])
    expect(targets).toEqual([a, b])
    expect(jobs.map((j) => [j.tpl, j.ctx.index, j.ctx.total, j.ctx.current])).toEqual([
      ['{{ index }}', 1, 2, 'Ann'],
      ['{{ index }}', 2, 2, 'Bo']
    ])
  })
  it('builds contexts with the current value', () => {
    const a = acct({ firstName: 'Ann' })
    expect(contextFor(a, 3, 7, 'now', []).current).toBe('now')
    expect(emptyContext([]).index).toBe(1)
  })
})

describe('planBulk', () => {
  it('sorts rows into changes, no-ops, skips, invalid and pending', () => {
    const change = acct({ firstName: 'Ann' })
    const same = acct({ firstName: 'Bo' })
    const blank = acct({ firstName: 'Cy' })
    const out = acct({ status: 'signed-out', firstName: 'Di' })
    const picked = [change, same, blank, out]
    const targets = [change, same, blank]
    const plan = planBulk(picked, first, targets, [
      { ok: true, value: 'ANN' },
      { ok: true, value: 'Bo' },
      { ok: true, value: '  ' }
    ])
    expect(plan.rows.map((r) => [r.kind, r.after])).toEqual([
      ['change', 'ANN'],
      ['same', 'No change'],
      ['invalid', "Can't be blank"],
      ['skip', 'Not signed in']
    ])
    expect(plan.changes).toEqual([{ account: change, prev: 'Ann', next: 'ANN' }])
    expect(plan.invalid).toBe(1)
    expect(plan.templateError).toBeNull()
  })
  it('shows pending rows until results arrive', () => {
    const a = acct()
    const plan = planBulk([a], first, [a], null)
    expect(plan.rows[0].kind).toBe('pending')
    expect(plan.changes).toEqual([])
  })
  it('keeps the first template error', () => {
    const a = acct()
    const b = acct()
    const plan = planBulk([a, b], first, [a, b], [
      { ok: false, error: 'unexpected end' },
      { ok: false, error: 'other' }
    ])
    expect(plan.templateError).toBe('unexpected end')
    expect(plan.rows.map((r) => r.kind)).toEqual(['invalid', 'invalid'])
    expect(plan.invalid).toBe(0)
  })
  it('allows an empty local name (clears it)', () => {
    const a = acct({ localName: 'Old' })
    const plan = planBulk([a], local, [a], [{ ok: true, value: '' }])
    expect(plan.rows[0]).toMatchObject({ kind: 'change', after: 'Empty' })
  })
})
