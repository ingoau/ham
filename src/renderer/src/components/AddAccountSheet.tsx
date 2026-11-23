import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { SignInResult } from '@shared/types'
import { CloseIcon } from '../icons'

type Step = 'email' | 'code' | 'totp' | 'backup' | 'passkey-only'

interface Props {
  /** Signing an existing, signed-out account in again. */
  reauth?: { accountId: string; email: string }
  onDone(accountId: string, existing: boolean): void
  onClose(): void
}

const RESEND_COOLDOWN = 60

function messageFor(result: SignInResult): string | null {
  if (!('error' in result)) return null
  switch (result.error) {
    case 'no-account':
      return "There's no Hack Club account for this email."
    case 'invalid-email':
      return 'Enter a valid email address.'
    case 'invalid-code':
      return result.message
    case 'rate-limited':
      return 'Too many attempts. Wait a few minutes, then try again.'
    case 'locked':
    case 'network':
    case 'unexpected':
      return result.message
  }
}

export function AddAccountSheet({ reauth, onDone, onClose }: Props) {
  const [step, setStep] = useState<Step>(reauth ? 'code' : 'email')
  const [email, setEmail] = useState(reauth?.email ?? '')
  const [code, setCode] = useState('')
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noAccount, setNoAccount] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [starting, setStarting] = useState(Boolean(reauth))
  const finished = useRef(false)
  const attemptRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  attemptRef.current = attemptId

  // Cancel an unfinished attempt when the sheet closes.
  useEffect(
    () => () => {
      if (!finished.current && attemptRef.current) void window.ham.signIn.cancel(attemptRef.current)
    },
    []
  )

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => {
    inputRef.current?.focus()
  }, [step, starting])

  const apply = (result: SignInResult) => {
    setAttemptId(result.attemptId)
    const message = messageFor(result)
    setNoAccount('error' in result && result.error === 'no-account')
    if (message) {
      setError(message)
      return
    }
    setError(null)
    if ('step' in result) {
      if (result.step === 'done') {
        finished.current = true
        onDone(result.accountId, result.existing)
        return
      }
      if (result.step === 'code') setCooldown(RESEND_COOLDOWN)
      setCode('')
      setStep(result.step)
    }
  }

  const run = async (fn: () => Promise<SignInResult>) => {
    setBusy(true)
    try {
      apply(await fn())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  // Signing in again: send the code straight away (once, even under StrictMode).
  const started = useRef(false)
  useEffect(() => {
    if (!reauth || started.current) return
    started.current = true
    void (async () => {
      await run(() => window.ham.signIn.start(reauth.email, reauth.accountId))
      setStarting(false)
    })()
  }, [])

  const submitEmail = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    void run(() => window.ham.signIn.start(email))
  }

  const digits = code.replace(/[^0-9]/g, '')
  const submitCode = (e?: FormEvent) => {
    e?.preventDefault()
    if (busy || !attemptId || digits.length !== 6) return
    void run(() => window.ham.signIn.submitEmailCode(attemptId, digits))
  }

  const submitSecond = (e: FormEvent) => {
    e.preventDefault()
    if (busy || !attemptId) return
    const kind = step === 'backup' ? 'backup' : 'totp'
    void run(() => window.ham.signIn.submitSecondFactor(attemptId, kind, code))
  }

  const onCodeChange = (value: string, autoSubmit: boolean) => {
    const clean = value.replace(/[^0-9]/g, '').slice(0, 6)
    setCode(clean)
    setError(null)
    if (autoSubmit && clean.length === 6 && attemptId && !busy) {
      void run(() => window.ham.signIn.submitEmailCode(attemptId, clean))
    }
  }

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <button className="icon-btn sheet-close" aria-label="Close" onClick={onClose}>
          <CloseIcon size={18} />
        </button>

        {step === 'email' && (
          <form onSubmit={submitEmail}>
            <div className="sheet-head">
              <h2 id="sheet-title">Add a Hack Club account</h2>
              <p className="lead">Enter the email you use for Hack Club. We'll email you a code to sign in.</p>
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                ref={inputRef}
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError(null)
                  setNoAccount(false)
                }}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            {error && (
              <p className="error-text" role="alert">
                {error}{' '}
                {noAccount && (
                  <button type="button" className="btn-link strong" style={{ minHeight: 0 }} onClick={() => void window.ham.openExternal('https://auth.hackclub.com/signup')}>
                    Create one on auth.hackclub.com
                  </button>
                )}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-block" disabled={!emailValid || busy}>
              {busy ? 'Sending code…' : 'Send code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={submitCode}>
            <div className="sheet-head">
              <h2 id="sheet-title">{reauth ? 'Sign in again' : 'Check your email'}</h2>
              <p className="lead">
                {starting ? (
                  <>Sending a code to <strong>{email}</strong>…</>
                ) : (
                  <>We sent a 6-digit code to <strong>{email}</strong>. It expires in a few minutes.</>
                )}
              </p>
            </div>
            <div className="field">
              <label htmlFor="code">Sign-in code</label>
              <input
                ref={inputRef}
                id="code"
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                disabled={starting}
                onChange={(e) => onCodeChange(e.target.value, true)}
              />
            </div>
            {error && <p className="error-text" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={digits.length !== 6 || busy || starting}>
              {busy && !starting ? 'Checking…' : 'Sign in'}
            </button>
            <div className="sheet-links">
              {!reauth ? (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    if (attemptId) void window.ham.signIn.cancel(attemptId)
                    setAttemptId(null)
                    setStep('email')
                    setError(null)
                  }}
                >
                  Use a different email
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="btn-link strong"
                disabled={cooldown > 0 || busy || !attemptId}
                onClick={() => attemptId && void run(() => window.ham.signIn.resend(attemptId))}
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        {(step === 'totp' || step === 'backup') && (
          <form onSubmit={submitSecond}>
            <div className="sheet-head">
              <h2 id="sheet-title">Two-factor code</h2>
              <p className="lead">
                {step === 'totp'
                  ? 'This account has two-factor authentication on. Enter the code from your authenticator app.'
                  : 'Enter one of the backup codes you saved when you set up two-factor. Each code works once.'}
              </p>
            </div>
            <div className="field">
              <label htmlFor="second">{step === 'totp' ? 'Authenticator code' : 'Backup code'}</label>
              <input
                ref={inputRef}
                id="second"
                className={step === 'totp' ? 'code-input' : undefined}
                inputMode={step === 'totp' ? 'numeric' : 'text'}
                autoComplete="one-time-code"
                placeholder={step === 'totp' ? '000000' : 'Backup code'}
                value={code}
                onChange={(e) => {
                  setCode(step === 'totp' ? e.target.value.replace(/[^0-9]/g, '').slice(0, 6) : e.target.value.slice(0, 32))
                  setError(null)
                }}
              />
            </div>
            {error && <p className="error-text" role="alert">{error}</p>}
            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={busy || (step === 'totp' ? code.length !== 6 : code.trim().length < 6)}
            >
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="btn-link strong"
              onClick={() => {
                setStep(step === 'totp' ? 'backup' : 'totp')
                setCode('')
                setError(null)
              }}
            >
              {step === 'totp' ? 'Use a backup code instead' : 'Use your authenticator app instead'}
            </button>
          </form>
        )}

        {step === 'passkey-only' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="sheet-head">
              <h2 id="sheet-title">This account needs a passkey</h2>
              <p className="lead">
                Two-factor is required on this account, and a passkey is its only second step. HAM doesn't use passkeys.
              </p>
            </div>
            <p className="lead">
              Add an authenticator app or backup codes in your security settings on auth.hackclub.com, then add the
              account here again. If you already have backup codes, you can use one now.
            </p>
            <div className="dialog-actions" style={{ flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={() => {
                  setStep('backup')
                  setCode('')
                }}
              >
                Use a backup code
              </button>
              <button className="btn btn-primary" onClick={() => void window.ham.openExternal('https://auth.hackclub.com/security')}>
                Open security settings
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
