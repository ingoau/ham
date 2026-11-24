import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, Eye, EyeOff, LoaderCircle, RotateCw, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Account, SlackTokensResult } from '@shared/types'
import { maskToken, tokenRows, toEnv, type TokenKey } from '@shared/slack-env'

interface Props {
  open?: boolean
  account: Account
  onClose(): void
}

/** Signs the account in to Slack afresh (in a throwaway session) and shows the tokens to copy. */
export function SlackTokensDialog({ open = true, account, onClose }: Props) {
  const [result, setResult] = useState<SlackTokensResult | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState<TokenKey | 'env' | null>(null)

  useEffect(() => {
    let live = true
    setResult(null)
    window.ham.accounts
      .slackTokens(account.id)
      .catch((): SlackTokensResult => ({ ok: false, reason: 'failed', message: 'Couldn’t get Slack tokens. Try again.' }))
      .then((r) => live && setResult(r))
    return () => {
      live = false
    }
  }, [account.id, attempt])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 1500)
    return () => clearTimeout(t)
  }, [copied])

  const rows = result?.ok ? tokenRows(result.tokens) : []
  const copy = async (what: TokenKey | 'env', text: string, label: string) => {
    await window.ham.copyText(text)
    setCopied(what)
    toast.success(`Copied ${label}`)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet sheet-wide" aria-describedby="tokens-lead">
          <div className="sheet-head">
            <Dialog.Title>Slack tokens</Dialog.Title>
            <Dialog.Description className="lead" id="tokens-lead">
              {account.email}
              {result?.ok && <span className="mono-inline"> · {result.tokens.userId}</span>}
            </Dialog.Description>
          </div>
          <Dialog.Close className="icon-btn sheet-close" aria-label="Close">
            <X size={18} aria-hidden />
          </Dialog.Close>

          {!result && (
            <div className="tokens-status" role="status">
              <LoaderCircle size={16} aria-hidden className="spin" />
              Signing in to Slack…
            </div>
          )}

          {result && !result.ok && (
            <ul className="errors" role="alert">
              <li>{result.message}</li>
            </ul>
          )}

          {result?.ok && (
            <ul className="token-list" aria-label="Tokens">
              {rows.map((row) => (
                <li key={row.key} className="token-row">
                  <div className="token-head">
                    <span className="token-label">{row.label}</span>
                    {row.id && <span className="token-id">{row.id}</span>}
                    <code className="token-key">{row.key}</code>
                  </div>
                  <div className="token-body">
                    <code className={`token-value${shown ? ' shown' : ''}`} aria-label={`${row.key} value`}>
                      {shown ? row.value : maskToken(row.value)}
                    </code>
                    <button
                      type="button"
                      className="icon-btn small"
                      aria-label={`Copy ${row.key}`}
                      title={`Copy ${row.key}`}
                      onClick={() => void copy(row.key, row.value, row.key)}
                    >
                      {copied === row.key ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="dialog-actions split">
            {result?.ok ? (
              <button type="button" className="btn" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
                {shown ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                {shown ? 'Hide' : 'Show'}
              </button>
            ) : (
              <span />
            )}
            <div className="dialog-actions">
              {result && !result.ok && result.reason === 'failed' && (
                <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
                  <RotateCw size={15} aria-hidden />
                  Try again
                </button>
              )}
              {result?.ok ? (
                <button type="button" className="btn btn-primary" onClick={() => void copy('env', toEnv(rows), '.env')}>
                  {copied === 'env' ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                  Copy all as .env
                </button>
              ) : (
                <Dialog.Close className="btn">{result ? 'Close' : 'Cancel'}</Dialog.Close>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
