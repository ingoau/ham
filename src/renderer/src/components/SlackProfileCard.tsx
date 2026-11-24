import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { Info, LogOut, MessageSquare } from 'lucide-react'
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
  /** Sign out of Slack only. */
  onSignOut(): Promise<void>
  onSaved(text: string, kind: 'success' | 'error'): void
}

const TIMEZONES: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []

const byId = (fields: FieldDef[]) => new Map(fields.map((f) => [f.id, f]))
const std = byId(SLACK_PROFILE_FIELDS)

/** When each "clear status after" choice ends, from now. */
const EXPIRY_PRESETS: { id: string; label: string; at(): Date }[] = [
  { id: '30m', label: '30 minutes', at: () => new Date(Date.now() + 30 * 60_000) },
  { id: '1h', label: '1 hour', at: () => new Date(Date.now() + 60 * 60_000) },
  { id: '4h', label: '4 hours', at: () => new Date(Date.now() + 4 * 60 * 60_000) },
  {
    id: 'today',
    label: 'Today',
    at: () => {
      const d = new Date()
      d.setHours(23, 59, 0, 0)
      return d
    }
  },
  {
    id: 'week',
    label: 'This week',
    at: () => {
      const d = new Date()
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
      d.setHours(23, 59, 0, 0)
      return d
    }
  }
]

const isoMinute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString().replace(':00.000Z', ':00Z')

/** An ISO time as a datetime-local input value, in local time. */
function localInput(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

function draftOf(account: Account, fields: FieldDef[]): SlackProfile {
  const d: SlackProfile = {}
  for (const f of fields) d[f.id] = account.slack.profile[f.id] ?? ''
  return d
}

/** The account's Hack Club Slack profile, saved with its own Slack session. */
export const SlackProfileCard = forwardRef<SlackProfileHandle, Props>(function SlackProfileCard({ account, custom, accounts, onLaunch, onSignOut, onSaved }, ref) {
  const [signingOut, setSigningOut] = useState(false)
  const fields = useMemo(() => [...SLACK_PROFILE_FIELDS, ...custom], [custom])
  const [draft, setDraft] = useState<SlackProfile>(() => draftOf(account, fields))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  // Which "clear status after" choice was picked, so the menu keeps showing it.
  const [expiryChoice, setExpiryChoice] = useState<string | null>(null)
  const session = account.slack.session
  const profileKey = JSON.stringify(account.slack.profile)
  // The values the draft started from, to tell the user's edits from Slack's.
  const base = useRef({ id: account.id, values: draft })

  // A different account resets the form. Fresh values from Slack (they're read
  // whenever the window gets focus) only replace fields the user hasn't edited.
  useEffect(() => {
    const next = draftOf(account, fields)
    const prev = base.current
    if (prev.id !== account.id) {
      setDraft(next)
      setErrors([])
    } else {
      setDraft((d) => {
        const merged = { ...next }
        for (const f of fields) if (f.id in d && d[f.id] !== (prev.values[f.id] ?? '')) merged[f.id] = d[f.id]
        return merged
      })
    }
    base.current = { id: account.id, values: next }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, profileKey, fields])

  const saved = (f: FieldDef) => account.slack.profile[f.id] ?? ''
  const edited = (f: FieldDef) => {
    const v = draft[f.id] ?? ''
    return v !== saved(f) && v.trim() !== saved(f).trim()
  }
  const changed = fields.filter((f) => !f.locked && edited(f))
  // A link's display text needs a URL: Slack drops the text otherwise.
  const linkProblem = (f: FieldDef) => {
    if (f.part !== 'url' || !f.slack) return ''
    const text = (draft[`${f.slack.id}.text`] ?? '').trim()
    return text && !(draft[f.id] ?? '').trim() ? 'Add a URL for the display text' : ''
  }
  const problems = fields
    .filter((f) => !f.locked && (edited(f) || (f.part === 'url' && changed.some((c) => c.slack?.id === f.slack?.id))))
    .map((f) => [f, checkValue(f, draft[f.id] ?? '') || linkProblem(f)] as const)
    .filter(([, p]) => p)
  const problemOf = (f: FieldDef) => problems.find(([p]) => p.id === f.id)?.[1] ?? ''
  const dirty = changed.length > 0
  const canSave = session && dirty && problems.length === 0 && !saving

  const resetTo = (a: Account) => {
    const values = draftOf(a, fields)
    setDraft(values)
    base.current = { id: a.id, values }
    setErrors([])
    setExpiryChoice(null)
  }
  const revert = () => resetTo(account)

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSave) return
    setSaving(true)
    setErrors([])
    try {
      const changes: SlackProfile = {}
      for (const f of changed) changes[f.id] = draft[f.id] ?? ''
      const r = await window.ham.accounts.saveSlack(account.id, changes)
      if (r.ok) {
        // Slack may tidy values (trimmed text, say): show what it kept.
        resetTo(r.account)
        onSaved('Saved to Slack', 'success')
      }
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

  // "Clear status after": never, a preset from now, or a set time.
  const expiryField = (f: FieldDef) => {
    const value = draft[f.id] ?? ''
    const set = (v: string) => setDraft((d) => ({ ...d, [f.id]: v }))
    return (
      <div className="field">
        {label(f)}
        <div className="grid-2 tight">
          <select
            id={`slack-${f.id}`}
            className="select"
            value={value ? (expiryChoice ?? 'at') : 'never'}
            disabled={disabled}
            aria-describedby={problemOf(f) ? `slack-${f.id}-hint` : undefined}
            onChange={(e) => {
              const choice = e.target.value
              setExpiryChoice(choice)
              if (choice === 'never') return set('')
              const preset = EXPIRY_PRESETS.find((p) => p.id === choice)
              set(isoMinute(preset ? preset.at() : EXPIRY_PRESETS[1].at()))
            }}
          >
            <option value="never">Don’t clear</option>
            {EXPIRY_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="at">At a set time</option>
          </select>
          {value && (
            <input
              type="datetime-local"
              aria-label="Clear status at"
              value={localInput(value)}
              disabled={disabled}
              aria-invalid={!!problemOf(f)}
              onChange={(e) => {
                setExpiryChoice('at')
                set(e.target.value ? isoMinute(new Date(e.target.value)) : '')
              }}
            />
          )}
        </div>
        {note(f)}
      </div>
    )
  }

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
      // One note for both halves, so both inputs point at it.
      const shown = problemOf(f) ? f : url
      const noteId = problemOf(shown) || shown.hint ? `slack-${shown.id}-hint` : undefined
      return (
        <div className="field" key={f.id}>
          {label(f, f.slack?.label)}
          <div className="grid-2 tight">
            {input(f, { placeholder: 'Display text', 'aria-label': `${f.slack?.label} display text`, 'aria-describedby': noteId })}
            {input(url, { placeholder: 'https://', type: 'url', 'aria-label': `${f.slack?.label} URL`, 'aria-describedby': noteId })}
          </div>
          {note(shown)}
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
      <div className="card-title-row">
        <h2 id="slack-heading">Slack profile</h2>
        {session && (
          <button
            type="button"
            className="btn btn-small"
            disabled={signingOut || saving}
            onClick={() => {
              setSigningOut(true)
              void onSignOut().finally(() => setSigningOut(false))
            }}
          >
            <LogOut size={15} aria-hidden />
            {signingOut ? 'Signing out…' : 'Sign out of Slack'}
          </button>
        )}
      </div>

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
            {expiryField(std.get('status_expiration')!)}
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
