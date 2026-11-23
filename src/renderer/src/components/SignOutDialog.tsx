import { useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import type { Account } from '@shared/types'

interface Props {
  open?: boolean
  account: Account
  onConfirm(): Promise<void>
  onCancel(): void
}

export function SignOutDialog({ open = true, account, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false)
  const signedIn = account.status === 'signed-in'

  return (
    <AlertDialog.Root open={open} onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="sheet">
          <div className="sheet-head">
            <AlertDialog.Title>{signedIn ? `Sign out of ${account.email}?` : `Remove ${account.email}?`}</AlertDialog.Title>
            <AlertDialog.Description className="lead">
              {signedIn
                ? 'This ends the session on auth.hackclub.com and removes the account from HAM. You can add it again later.'
                : 'This removes the account and its data from this computer. You can add it again later.'}
            </AlertDialog.Description>
          </div>
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
              {busy ? 'Signing out…' : signedIn ? 'Sign out' : 'Remove'}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
