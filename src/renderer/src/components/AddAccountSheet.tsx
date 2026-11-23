import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from 'input-otp'
import { X } from 'lucide-react'
import type { SignInResult } from '@shared/types'

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

function Slot({ char, hasFakeCaret, isActive }: SlotProps) {
  return (
    <div className="otp-slot" data-active={isActive || undefined}>
      {char}
      {hasFakeCaret && <div className="otp-caret" />}
    </div>
  )
}

/** A six-digit code field. The second group is split off like the emailed "123-456". */
function CodeField({
  id,
  value,
  onChange,
  onComplete,
  disabled,
  inputRef
}: {
  id: string
  value: string
  onChange(v: string): void
  onComplete(v: string): void
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
}) {
  return (
    <OTPInput
      id={id}
      ref={inputRef}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      disabled={disabled}
      // Pasting "684-629" from the email still works: keep only the digits.
      pasteTransformer={(text) => text.replace(/\D/g, '').slice(0, 6)}
      onChange={onChange}
      onComplete={onComplete}
      containerClassName="otp"
      render={({ slots }) => (
        <>
          <div className="otp-group">
            {slots.slice(0, 3).map((slot, i) => (
              <Slot key={i} {...slot} />
            ))}
          </div>
          <div className="otp-dash" aria-hidden />
          <div className="otp-group">
            {slots.slice(3).map((slot, i) => (
              <Slot key={i} {...slot} />
            ))}
          </div>
        </>
      )}
    />
  )
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
      if ('error' in result && result.error === 'invalid-code') setCode('')
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
    if (!busy) void run(() => window.ham.signIn.start(email))
  }

  const submitEmailCode = (value = code) => {
    if (busy || !attemptId || value.length !== 6) return
    void run(() => window.ham.signIn.submitEmailCode(attemptId, value))
  }

  const submitSecond = (value = code) => {
    if (busy || !attemptId) return
    void run(() => window.ham.signIn.submitSecondFactor(attemptId, step === 'backup' ? 'backup' : 'totp', value))
  }

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  const titles: Record<Step, string> = {
    email: 'Add a Hack Club account',
    code: reauth ? 'Sign in again' : 'Check your email',
    totp: 'Two-factor code',
    backup: 'Two-factor code',
    'passkey-only': 'This account needs a passkey'
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className="sheet"
          aria-describedby="sheet-lead"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
          }}
          onInteractOutside={(e) => busy && e.preventDefault()}
        >
          <Dialog.Close className="icon-btn sheet-close" aria-label="Close">
            <X size={18} aria-hidden />
          </Dialog.Close>
          <div className="sheet-head">
            <Dialog.Title>{titles[step]}</Dialog.Title>
            <Dialog.Description id="sheet-lead" className="lead">
              {step === 'email' && "Enter the email you use for Hack Club. We'll email you a code to sign in."}
              {step === 'code' &&
                (starting ? (
                  <>Sending a code to <strong>{email}</strong>…</>
                ) : (
                  <>We sent a 6-digit code to <strong>{email}</strong>. It expires in a few minutes.</>
                ))}
              {step === 'totp' &&
                'This account has two-factor authentication on. Enter the code from your authenticator app.'}
              {step === 'backup' &&
                'Enter one of the backup codes you saved when you set up two-factor. Each code works once.'}
              {step === 'passkey-only' &&
                "Two-factor is required on this account, and a passkey is its only second step. HAM doesn't use passkeys."}
            </Dialog.Description>
          </div>

          {step === 'email' && (
            <form onSubmit={submitEmail}>
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
                    <button
                      type="button"
                      className="btn-link strong inline"
                      onClick={() => void window.ham.openExternal('https://auth.hackclub.com/signup')}
                    >
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
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submitEmailCode()
              }}
            >
              <div className="field">
                <label htmlFor="code">Sign-in code</label>
                <CodeField
                  id="code"
                  inputRef={inputRef}
                  value={code}
                  disabled={starting || busy}
                  onChange={(v) => {
                    setCode(v)
                    setError(null)
                  }}
                  onComplete={submitEmailCode}
                />
              </div>
              {error && <p className="error-text" role="alert">{error}</p>}
              <button type="submit" className="btn btn-primary btn-block" disabled={code.length !== 6 || busy || starting}>
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
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submitSecond()
              }}
            >
              <div className="field">
                <label htmlFor="second">{step === 'totp' ? 'Authenticator code' : 'Backup code'}</label>
                {step === 'totp' ? (
                  <CodeField
                    id="second"
                    inputRef={inputRef}
                    value={code}
                    disabled={busy}
                    onChange={(v) => {
                      setCode(v)
                      setError(null)
                    }}
                    onComplete={submitSecond}
                  />
                ) : (
                  <input
                    ref={inputRef}
                    id="second"
                    autoComplete="one-time-code"
                    placeholder="Backup code"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.slice(0, 32))
                      setError(null)
                    }}
                  />
                )}
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
            <>
              <p className="lead">
                Add an authenticator app or backup codes in your security settings on auth.hackclub.com, then add the
                account here again. If you already have backup codes, you can use one now.
              </p>
              <div className="dialog-actions">
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
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
