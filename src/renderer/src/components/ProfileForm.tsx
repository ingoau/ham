import { forwardRef, useEffect, useImperativeHandle, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Account, SaveResult } from '@shared/types'
import { InfoIcon } from '../icons'

export interface ProfileFormHandle {
  save(): void
  revert(): boolean
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

const fromAccount = (a: Account): Draft => ({ firstName: a.firstName, lastName: a.lastName, phone: a.phone })

export const ProfileForm = forwardRef<ProfileFormHandle, Props>(function ProfileForm({ account, onSaved }, ref) {
  const [draft, setDraft] = useState<Draft>(() => fromAccount(account))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const signedOut = account.status === 'signed-out'

  // A different account, or fresh values from the server, reset the form.
  useEffect(() => {
    setDraft(fromAccount(account))
    setErrors([])
  }, [account.id, account.firstName, account.lastName, account.phone])

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
      if (!result.ok && result.reason === 'validation') setErrors(result.messages)
      else if (!result.ok && result.reason !== 'signed-out') setErrors([result.message])
      onSaved(result)
    } finally {
      setSaving(false)
    }
  }

  useImperativeHandle(ref, () => ({
    save: () => void save(),
    revert: () => {
      if (!dirty) return false
      setDraft(fromAccount(account))
      setErrors([])
      return true
    }
  }))

  const set = (field: keyof Draft) => (e: ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [field]: e.target.value }))

  return (
    <form className="card" onSubmit={save} aria-labelledby="profile-heading" style={{ opacity: signedOut ? 0.6 : 1 }}>
      <div>
        <h2 id="profile-heading">Profile</h2>
        <p className="lead">
          Saved straight to auth.hackclub.com. Apps you've signed in to with this account will see the change.
        </p>
      </div>
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
        <span className="hint">Optional. Include your country code.</span>
      </div>

      {account.hasLegalName && (
        <div className="banner info">
          <InfoIcon />
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
                setDraft(fromAccount(account))
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
