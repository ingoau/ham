import { forwardRef, useEffect, useImperativeHandle, useMemo, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { Info, MessageSquare } from 'lucide-react'
import { SLACK_PROFILE_FIELDS, checkValue, type FieldDef } from '@shared/fields'
import type { Account, SlackProfile } from '@shared/types'
import { bestName } from '../util'

export interface SlackProfileHandle {
  save(): void
  revert(): boolean
}

interface Props {
  account: Account
  /** The workspace's own Slack fields (slackCustomFields). */
  custom: FieldDef[]
  /** Every account, to suggest people for fields such as Manager. */
  accounts: Account[]
  onLaunch(): void
  onSaved(text: string, kind: 'success' | 'error'): void
}

const TIMEZONES: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []

const byId = (fields: FieldDef[]) => new Map(fields.map((f) => [f.id, f]))
const std = byId(SLACK_PROFILE_FIELDS)

function draftOf(account: Account, fields: FieldDef[]): SlackProfile {
  const d: SlackProfile = {}
  for (const f of fields) d[f.id] = account.slack.profile[f.id] ?? ''
  return d
}

/** The account's Hack Club Slack profile, saved with its own Slack session. */
export const SlackProfileCard = forwardRef<SlackProfileHandle, Props>(function SlackProfileCard({ account, custom, accounts, onLaunch, onSaved }, ref) {
  const fields = useMemo(() => [...SLACK_PROFILE_FIELDS, ...custom], [custom])
  const [draft, setDraft] = useState<SlackProfile>(() => draftOf(account, fields))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const session = account.slack.session
  const profileKey = JSON.stringify(account.slack.profile)

  // A different account, fresh values from Slack, or a new field list reset the form.
  useEffect(() => {
    setDraft(draftOf(account, fields))
    setErrors([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, profileKey, fields])

  const changed = fields.filter((f) => !f.locked && (draft[f.id] ?? '') !== (account.slack.profile[f.id] ?? ''))
  const problems = changed.map((f) => [f, checkValue(f, draft[f.id] ?? '')] as const).filter(([, p]) => p)
  const problemOf = (f: FieldDef) => problems.find(([p]) => p.id === f.id)?.[1] ?? ''
  const dirty = changed.length > 0
  const canSave = session && dirty && problems.length === 0 && !saving

  const revert = () => {
    setDraft(draftOf(account, fields))
    setErrors([])
  }

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSave) return
    setSaving(true)
    setErrors([])
    try {
      const changes: SlackProfile = {}
      for (const f of changed) changes[f.id] = draft[f.id] ?? ''
      const r = await window.ham.accounts.saveSlack(account.id, changes)
      if (r.ok) onSaved('Saved to Slack', 'success')
      else if (r.reason === 'slack-signed-out') onSaved('Slack signed this account out. Launch Slack to sign in again.', 'error')
      else setErrors([r.message])
    } finally {
      setSaving(false)
    }
  }

  useImperativeHandle(ref, () => ({
    save: () => void save(),
    revert: () => {
      if (!dirty) return false
      revert()
      return true
    }
  }))

  // People this account could point to: other accounts on Slack.
  const people = useMemo(
    () => accounts.filter((a) => a.slack.id && a.id !== account.id).map((a) => ({ id: a.slack.id!, name: bestName(a) })),
    [accounts, account.id]
  )
  const nameOf = (id: string) => account.slack.users?.[id] ?? people.find((p) => p.id === id)?.name ?? id

  const hasValues = Object.keys(account.slack.profile).length > 0
  if (!session && !account.slack.linked) return null
  const disabled = !session || saving

  const input = (f: FieldDef, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <input
      id={`slack-${f.id}`}
      value={draft[f.id] ?? ''}
      onChange={(e) => setDraft((d) => ({ ...d, [f.id]: e.target.value }))}
      disabled={disabled || f.locked}
      aria-invalid={!!problemOf(f)}
      aria-describedby={problemOf(f) || f.hint ? `slack-${f.id}-hint` : undefined}
      spellCheck={false}
      {...extra}
    />
  )

  const note = (f: FieldDef, text?: string) => {
    const problem = problemOf(f)
    const shown = problem || text || f.hint
    if (!shown) return null
    return (
      <span id={`slack-${f.id}-hint`} className={problem ? 'error-text small' : 'hint'}>
        {shown}
      </span>
    )
  }

  const label = (f: FieldDef, text = f.name) => (
    <div className="label-row">
      <label htmlFor={`slack-${f.id}`}>{text}</label>
      {f.locked && <span className="muted small">Admin only</span>}
    </div>
  )

  const simple = (f: FieldDef, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div className="field" key={f.id}>
      {label(f)}
      {input(f, extra)}
      {note(f)}
    </div>
  )

  // The workspace's own fields, by Slack's sections. A link's two halves sit together.
  // Header fields (name pronunciation) go with the names instead of under a heading of their own.
  const isHeader = (f: FieldDef) => f.slack?.sectionType === 'HEADER'
  const sections: { label: string; fields: FieldDef[] }[] = []
  for (const f of custom.filter((x) => !isHeader(x))) {
    const name = f.slack?.sectionLabel || 'Other'
    let s = sections.find((x) => x.label === name)
    if (!s) sections.push((s = { label: name, fields: [] }))
    s.fields.push(f)
  }

  const customField = (f: FieldDef) => {
    if (f.part === 'url') return null
    if (f.part === 'text') {
      const url = custom.find((u) => u.slack?.id === f.slack?.id && u.part === 'url')!
      return (
        <div className="field" key={f.id}>
          {label(f, f.slack?.label)}
          <div className="grid-2 tight">
            {input(f, { placeholder: 'Display text', 'aria-label': `${f.slack?.label} display text` })}
            {input(url, { placeholder: 'https://', type: 'url', 'aria-label': `${f.slack?.label} URL` })}
          </div>
          {note(url) ?? note(f)}
        </div>
      )
    }
    if (f.kind === 'user') {
      const ids = (draft[f.id] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      const names = ids.length && !problemOf(f) ? ids.map(nameOf).join(', ') : undefined
      return (
        <div className="field" key={f.id}>
          {label(f)}
          {input(f, { list: 'slack-people', placeholder: 'Slack user ID, e.g. U0123ABCD', className: 'mono-input' })}
          {note(f, names)}
        </div>
      )
    }
    if (f.kind === 'date') return simple(f, { type: 'date' })
    return simple(f, { placeholder: f.hint || undefined })
  }

  return (
    <form className="card" onSubmit={save} aria-labelledby="slack-heading">
      <h2 id="slack-heading">Slack profile</h2>

      {!session && (
        <div className="banner info">
          <Info size={16} aria-hidden style={{ flex: 'none' }} />
          <span className="text">
            Open Slack to edit this profile.
          </span>
          {account.status === 'signed-in' && (
            <button type="button" className="btn" onClick={onLaunch}>
              <MessageSquare size={15} aria-hidden />
              Launch Slack
            </button>
          )}
        </div>
      )}

      {(session || hasValues) && (
        <>
          <div className="grid-2">
            {simple(std.get('real_name')!, { autoComplete: 'off' })}
            {simple(std.get('display_name')!, { autoComplete: 'off' })}
            {simple(std.get('title')!)}
            {simple(std.get('pronouns')!)}
          </div>
          <div className="grid-2">
            {custom.filter(isHeader).map(customField)}
            {simple(std.get('tz')!, { list: 'slack-timezones', placeholder: 'e.g. Australia/Sydney' })}
          </div>

          <fieldset className="field-section">
            <legend>Status</legend>
            <div className="grid-2">
              {simple(std.get('status_emoji')!, { placeholder: ':wave:', className: 'mono-input' })}
              {simple(std.get('status_text')!, { placeholder: 'What’s happening?' })}
            </div>
          </fieldset>

          {sections.map((s) => (
            <fieldset key={s.label} className="field-section">
              <legend>{s.label}</legend>
              {s.fields.map(customField)}
            </fieldset>
          ))}
        </>
      )}

      <datalist id="slack-timezones">
        {TIMEZONES.map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>
      <datalist id="slack-people">
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </datalist>

      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {session && (
        <div className="form-actions">
          {dirty && (
            <>
              <span className="status">{problems.length ? 'Fix the highlighted fields to save' : 'Unsaved changes'}</span>
              <button type="button" className="btn" disabled={saving} onClick={revert}>
                Revert
              </button>
            </>
          )}
          <button type="submit" className="btn btn-primary" disabled={!canSave} style={{ minWidth: 96 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </form>
  )
})
