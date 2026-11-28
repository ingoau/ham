import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { Account, InboxStatus } from '@shared/types'
import { attemptLeft, mmss } from '../view'
import { CodeField } from './CodeField'
import { Ticking } from './Ticking'

interface Props {
  account: Account
  inbox: InboxStatus
  onRemove(): void
  onOpenSettings(): void
}

/** The inline sign-in for an account that's still being added (or signing in again). */
export function PendingPane({ account: a, inbox, onRemove, onOpenSettings }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backup, setBackup] = useState(a.pending?.second === 'backup')
  const inputRef = useRef<HTMLInputElement>(null)
  const p = a.pending
  const inboxOn = inbox.state === 'connected'
  // Only the countdown text ticks, not the whole pane.
  const left = <Ticking>{(now) => mmss(attemptLeft(a, now))}</Ticking>
  const expired = !!p?.expired && !inboxOn

  const startOnBackup = a.pending?.second === 'backup'
  useEffect(() => {
    setCode('')
    setError(null)
    setBackup(startOnBackup)
  }, [a.id, a.status, startOnBackup])

  useEffect(() => {
    if ((a.status === 'waiting' && !inboxOn) || a.status === 'needs2fa') inputRef.current?.focus()
  }, [a.id, a.status, inboxOn])

  const submit = async (value = code) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r =
        a.status === 'needs2fa'
          ? await window.ham.accounts.submitSecondFactor(a.id, backup ? 'backup' : 'totp', value)
          : await window.ham.accounts.submitCode(a.id, value)
      if (!r.ok) {
        setError(r.message)
        setCode('')
      }
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit()
  }

  const restart = () => void window.ham.accounts.restart(a.id)
  const removeLabel = !a.fresh ? 'Cancel' : a.status === 'failed' || a.status === 'stuck' ? 'Remove' : 'Cancel and remove'

  let body: ReactNode
  switch (a.status) {
    case 'queued':
      body = (
        <div className="pending-head">
          <h2>Queued</h2>
          <p className="muted">
            <Ticking>{(now) => (p?.startsAt && Date.parse(p.startsAt) > now ? `Starts in ${mmss(Date.parse(p.startsAt) - now)}.` : 'Starting…')}</Ticking>
          </p>
        </div>
      )
      break
    case 'sending':
      body = (
        <div className="pending-head">
          <h2>
            <Loader2 size={18} className="spin" aria-hidden /> Sending a sign-in code…
          </h2>
          <p className="muted">Asking auth.hackclub.com to email {a.email}.</p>
        </div>
      )
      break
    case 'waiting':
      body = expired ? (
        <div className="pending-head">
          <h2>This code expired</h2>
          <div className="form-actions start">
            <button className="btn btn-primary" onClick={restart}>
              Send a new code
            </button>
          </div>
        </div>
      ) : inboxOn && p?.autoCode ? (
        <div className="pending-head">
          <h2>Code found, signing in…</h2>
          <p className="muted">Watching {inbox.email} for the email from Hack Club Auth.</p>
          <div className="field">
            <label htmlFor="auto-code">From your inbox</label>
            <CodeField id="auto-code" value={p.autoCode} onChange={() => {}} disabled />
          </div>
        </div>
      ) : inboxOn ? (
        <form className="pending-head" onSubmit={onSubmit}>
          <h2>Waiting for the sign-in email…</h2>
          <p className="muted">Watching {inbox.email} for the email from Hack Club Auth.</p>
          <div className="field">
            <label htmlFor="pending-code">Sign-in code</label>
            <CodeField id="pending-code" value={code} disabled={busy} onChange={(v) => (setCode(v), setError(null))} onComplete={(v) => void submit(v)} />
          </div>
          {(error || p?.message) && <p className="error-text" role="alert">{error ?? p?.message}</p>}
        </form>
      ) : (
        <form className="pending-head" onSubmit={onSubmit}>
          <h2>Enter the code we emailed</h2>
          <p className="muted">
            Sent to {a.email}. This sign-in expires in {left}.
          </p>
          <div className="field">
            <label htmlFor="pending-code">Sign-in code</label>
            <CodeField id="pending-code" inputRef={inputRef} value={code} disabled={busy} onChange={(v) => (setCode(v), setError(null))} onComplete={(v) => void submit(v)} />
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="form-actions start">
            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button type="button" className="btn-link strong" onClick={restart}>
              Resend code
            </button>
            <button type="button" className="btn-link" style={{ marginLeft: 'auto' }} onClick={onOpenSettings}>
              Fill codes in automatically
            </button>
          </div>
        </form>
      )
      break
    case 'needs2fa':
      body = expired ? (
        <div className="pending-head">
          <h2>This sign-in expired</h2>
          <div className="form-actions start">
            <button className="btn btn-primary" onClick={restart}>
              Start again
            </button>
          </div>
        </div>
      ) : (
        <form className="pending-head" onSubmit={onSubmit}>
          <h2>Two-factor code needed</h2>
          <p className="muted">This sign-in expires in {left}.</p>
          <div className="field">
            <label htmlFor="pending-2fa">{backup ? 'Backup code' : 'Authenticator code'}</label>
            {backup ? (
              <input ref={inputRef} id="pending-2fa" autoComplete="one-time-code" value={code} onChange={(e) => (setCode(e.target.value.slice(0, 32)), setError(null))} />
            ) : (
              <CodeField id="pending-2fa" inputRef={inputRef} value={code} disabled={busy} onChange={(v) => (setCode(v), setError(null))} onComplete={(v) => void submit(v)} />
            )}
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="form-actions start">
            <button type="submit" className="btn btn-primary" disabled={busy || (backup ? code.trim().length < 6 : code.length !== 6)}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="btn-link strong"
              onClick={() => {
                setBackup(!backup)
                setCode('')
                setError(null)
              }}
            >
              {backup ? 'Use the authenticator app instead' : 'Use a backup code instead'}
            </button>
          </div>
        </form>
      )
      break
    case 'failed':
      body =
        p?.message === 'no-account' ? (
          <div className="pending-head">
            <h2>No Hack Club account for this email</h2>
            <p className="muted">Create the account at auth.hackclub.com, then add it here again.</p>
          </div>
        ) : (
          <div className="pending-head">
            <h2>Couldn’t sign in</h2>
            {p?.message && <p className="muted">{p.message}</p>}
            <div className="form-actions start">
              <button className="btn btn-primary" onClick={restart}>
                Try again
              </button>
            </div>
          </div>
        )
      break
    case 'stuck':
      body = (
        <div className="pending-head">
          <h2>This account needs a passkey</h2>
          <p className="muted">Add an authenticator app or backup codes at auth.hackclub.com/security, then try again.</p>
          <div className="form-actions start">
            <button className="btn" onClick={() => void window.ham.openExternal('https://auth.hackclub.com/security')}>
              Open security settings
            </button>
            <button className="btn btn-primary" onClick={restart}>
              Try again
            </button>
          </div>
        </div>
      )
      break
    default:
      body = null
  }

  return (
    <section className="card pending" aria-live="polite">
      {body}
      <div className="card-footer end">
        <button className="btn btn-danger" onClick={onRemove}>
          {removeLabel}
        </button>
      </div>
    </section>
  )
}
