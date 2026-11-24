import { useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { isPending, type Account } from '@shared/types'

interface Props {
  open?: boolean
  /** One account, or several from the selection. */
  accounts: Account[]
  onConfirm(): Promise<void>
  onCancel(): void
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`

function copy(accounts: Account[]) {
  if (accounts.length === 1) {
    const [a] = accounts
    return a.status === 'signed-in'
      ? {
          title: `Sign out of ${a.email}?`,
          body: 'This ends the session on auth.hackclub.com and removes the account from HAM. You can add it again later.',
          action: 'Sign out'
        }
      : { title: `Remove ${a.email}?`, body: 'This removes the account and its data from this computer. You can add it again later.', action: 'Remove' }
  }
  const signedIn = accounts.filter((a) => a.status === 'signed-in').length
  const pending = accounts.filter((a) => isPending(a.status)).length
  const n = accounts.length
  const parts = [
    signedIn ? `ends ${signedIn === n ? 'their sessions' : plural(signedIn, 'session')} on auth.hackclub.com` : null,
    pending ? `cancels ${plural(pending, 'sign-in')}` : null,
    signedIn || pending ? 'removes them from HAM' : 'removes them and their data from this computer'
  ].filter(Boolean)
  const lead = `This ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}`
  return {
    title: signedIn ? `Sign out of ${n} accounts?` : `Remove ${n} accounts?`,
    body: `${lead}. You can add them again later.`,
    action: signedIn ? `Sign out of ${n}` : `Remove ${n}`
  }
}

export function SignOutDialog({ open = true, accounts, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false)
  const { title, body, action } = copy(accounts)
  const many = accounts.length > 1
  const signingOut = accounts.some((a) => a.status === 'signed-in')

  return (
    <AlertDialog.Root open={open} onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="sheet">
          <div className="sheet-head">
            <AlertDialog.Title>{title}</AlertDialog.Title>
            <AlertDialog.Description className="lead">{body}</AlertDialog.Description>
          </div>
          {many && (
            <ul className="signout-list" aria-label="Accounts">
              {accounts.map((a) => (
                <li key={a.id}>
                  <span className="email">{a.email}</span>
                  {a.status !== 'signed-in' && <span className="muted small">{a.status === 'failed' || a.status === 'stuck' ? 'Couldn’t sign in' : isPending(a.status) ? 'Signing in' : 'Signed out'}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="dialog-actions">
            <AlertDialog.Cancel className="btn" disabled={busy}>
              Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
              className="btn btn-primary"
              disabled={busy}
              onClick={async (e) => {
                // Keep the dialog open until the server answers.
                e.preventDefault()
                setBusy(true)
                try {
                  await onConfirm()
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? (signingOut ? 'Signing out…' : 'Removing…') : action}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
