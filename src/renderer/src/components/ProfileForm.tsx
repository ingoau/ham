import { forwardRef, useImperativeHandle, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Account, SaveResult } from '@shared/types'
import { Info } from 'lucide-react'

export interface ProfileFormHandle {
  save(): void
  revert(): boolean
  /** Whether there are unsaved edits. */
  isDirty(): boolean
}

interface Props {
  account: Account
  onSaved(result: SaveResult): void
}

interface Draft {
  firstName: string
  lastName: string
  phone: string
}

const FIELDS = ['firstName', 'lastName', 'phone'] as const
const fromAccount = (a: Account): Draft => ({ firstName: a.firstName, lastName: a.lastName, phone: a.phone })

export const ProfileForm = forwardRef<ProfileFormHandle, Props>(function ProfileForm({ account, onSaved }, ref) {
  const { id, firstName, lastName, phone } = account
  // `base`: the server values the draft started from, to tell the user's edits from the server's.
  const [form, setForm] = useState(() => ({ id, base: fromAccount(account), draft: fromAccount(account) }))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const signedOut = account.status === 'signed-out'

  // A different account resets the form. Fresh values from the server (a refresh,
  // or a save elsewhere) only replace fields the user hasn't edited. Adjusted while
  // rendering, so no commit ever pairs one account's draft with another's values.
  let current = form
  if (form.id !== id) {
    current = { id, base: { firstName, lastName, phone }, draft: { firstName, lastName, phone } }
    setForm(current)
    setErrors([])
  } else if (FIELDS.some((f) => form.base[f] !== account[f])) {
    const server: Draft = { firstName, lastName, phone }
    const draft = { ...server }
    for (const f of FIELDS) if (form.draft[f] !== form.base[f]) draft[f] = form.draft[f]
    current = { id, base: server, draft }
    setForm(current)
  }
  const { draft } = current
  const setDraft = (fn: (d: Draft) => Draft) => setForm((f) => ({ ...f, draft: fn(f.draft) }))

  const dirty =
    draft.firstName !== account.firstName || draft.lastName !== account.lastName || draft.phone !== account.phone
  const missing = {
    first: draft.firstName.trim() === '',
    last: draft.lastName.trim() === ''
  }
  const invalid = missing.first || missing.last
  const canSave = dirty && !invalid && !saving && !signedOut

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSave) return
    setSaving(true)
    setErrors([])
    try {
      const result = await window.ham.accounts.save(account.id, draft)
      if (result.ok) {
        // The server tidies values ("Bob " is saved as "Bob"): show what it kept. Only the
        // draft: `base` catches up when the saved account arrives as a prop.
        const saved = fromAccount(result.account)
        setForm((f) => (f.id === result.account.id ? { ...f, draft: saved } : f))
      } else if (result.reason === 'validation') setErrors(result.messages)
      else if (result.reason !== 'signed-out') setErrors([result.message])
      onSaved(result)
    } finally {
      setSaving(false)
    }
  }

  useImperativeHandle(ref, () => ({
    save: () => void save(),
    isDirty: () => dirty && !signedOut,
    revert: () => {
      if (!dirty) return false
      setDraft(() => fromAccount(account))
      setErrors([])
      return true
    }
  }))

  const set = (field: keyof Draft) => (e: ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [field]: e.target.value }))

  return (
    <form className="card" onSubmit={save} aria-label="Profile" style={{ opacity: signedOut ? 0.6 : 1 }}>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="first-name">First name</label>
          <input
            id="first-name"
            value={draft.firstName}
            onChange={set('firstName')}
            disabled={signedOut || saving}
            aria-invalid={dirty && missing.first}
            autoComplete="given-name"
          />
        </div>
        <div className="field">
          <label htmlFor="last-name">Last name</label>
          <input
            id="last-name"
            value={draft.lastName}
            onChange={set('lastName')}
            disabled={signedOut || saving}
            aria-invalid={dirty && missing.last}
            autoComplete="family-name"
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="phone">Phone number</label>
        <input
          id="phone"
          type="tel"
          value={draft.phone}
          onChange={set('phone')}
          disabled={signedOut || saving}
          placeholder="+1 (555) 123-4567"
          autoComplete="tel"
        />
      </div>

      {account.hasLegalName && (
        <div className="banner info">
          <Info size={16} aria-hidden style={{ flex: 'none' }} />
          <span className="text">
            This account also has a legal name on file from verification. It isn't changed here; contact Hack Club to
            update it.
          </span>
        </div>
      )}

      {dirty && invalid && <p className="error-text" role="alert">First and last name can't be blank.</p>}
      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <div className="form-actions">
        {dirty && !signedOut && (
          <>
            <span className="status">Unsaved changes</span>
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => {
                setDraft(() => fromAccount(account))
                setErrors([])
              }}
            >
              Revert
            </button>
          </>
        )}
        <button type="submit" className="btn btn-primary" disabled={!canSave} style={{ minWidth: 96 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
})
