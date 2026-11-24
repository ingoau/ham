// Bulk edit planning: which selected accounts a template applies to, what it
// renders for each, and which rows are skipped, unchanged or invalid.
import { checkValue, fieldValue, isSlackField, templateAccount, type FieldDef, type TemplateContext } from '@shared/fields'
import type { Account } from '@shared/types'
import type { TemplateJob, TemplateResult } from './templates'

/** The workspace's own Slack fields, for contexts built without an account list at hand. */
let knownCustom: readonly FieldDef[] = []
export function setTemplateFields(custom: readonly FieldDef[]) {
  knownCustom = custom
}

export function emptyContext(custom: readonly FieldDef[] = knownCustom): TemplateContext {
  return { index: 1, total: 1, current: '', account: templateAccount(null, custom) }
}

/** `custom`: the workspace's own Slack fields (slackCustomFields). */
export function contextFor(a: Account, index: number, total: number, current: string, custom: readonly FieldDef[]): TemplateContext {
  return { index, total, current, account: templateAccount(a, custom) }
}

/** Why an account can't take this field, or null. */
export function skipReason(a: Account, field: FieldDef): string | null {
  if (field.local) return null
  if (isSlackField(field)) {
    // Slack saves with the account's own Slack session, which outlives Hack Club's.
    if (!a.slack.session) return a.slack.linked === false ? 'Not on Slack' : 'Open Slack first'
    // Without a read, "current" (and undo) would be blank rather than what Slack has.
    return a.slack.fetchedAt ? null : 'Refresh first'
  }
  if (a.status !== 'signed-in') return 'Not signed in'
  return null
}

export function bulkJobs(picked: Account[], field: FieldDef, tpl: string, custom: readonly FieldDef[]): { targets: Account[]; jobs: TemplateJob[] } {
  const targets = picked.filter((a) => !skipReason(a, field))
  const jobs = targets.map((a, i) => ({ tpl, ctx: contextFor(a, i + 1, targets.length, fieldValue(a, field), custom) }))
  return { targets, jobs }
}

/** Slack drops a link's display text without a URL. */
function linkProblem(a: Account, field: FieldDef, value: string): string {
  if (!field.part || !field.slack) return ''
  const other = a.slack.profile[`${field.slack.id}.${field.part === 'text' ? 'url' : 'text'}`] ?? ''
  if (field.part === 'text' && value.trim() && !other.trim()) return 'Needs a URL'
  if (field.part === 'url' && !value.trim() && other.trim()) return 'Has display text'
  return ''
}

export type RowKind = 'change' | 'same' | 'skip' | 'invalid' | 'pending'

export interface BulkRow {
  account: Account
  now: string
  after: string
  kind: RowKind
}

export interface BulkPlan {
  rows: BulkRow[]
  changes: { account: Account; prev: string; next: string }[]
  invalid: number
  templateError: string | null
}

export function planBulk(picked: Account[], field: FieldDef, targets: Account[], results: TemplateResult[] | null): BulkPlan {
  const rows: BulkRow[] = []
  const changes: BulkPlan['changes'] = []
  let invalid = 0
  let templateError: string | null = null
  for (const a of picked) {
    const now = fieldValue(a, field)
    const skip = skipReason(a, field)
    if (skip) {
      rows.push({ account: a, now, after: skip, kind: 'skip' })
      continue
    }
    const r = results?.[targets.indexOf(a)]
    if (!r) {
      rows.push({ account: a, now, after: '…', kind: 'pending' })
      continue
    }
    if (!r.ok) {
      templateError ??= r.error
      rows.push({ account: a, now, after: '—', kind: 'invalid' })
      continue
    }
    const problem = checkValue(field, r.value) || linkProblem(a, field, r.value)
    if (problem) {
      invalid++
      rows.push({ account: a, now, after: problem, kind: 'invalid' })
    } else if (r.value === now) {
      rows.push({ account: a, now, after: 'No change', kind: 'same' })
    } else {
      rows.push({ account: a, now, after: r.value || 'Empty', kind: 'change' })
      changes.push({ account: a, prev: now, next: r.value })
    }
  }
  return { rows, changes, invalid, templateError }
}
