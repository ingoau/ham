import * as AlertDialog from '@radix-ui/react-alert-dialog'
import type { Account } from '@shared/types'

interface LaunchProps {
  open: boolean
  account: Account
  onClose(): void
  onLaunch(account: Account): void
}

/** Before launching Slack on an account that might not be on Slack yet. */
export function SlackLaunchDialog({ open, account, onClose, onLaunch }: LaunchProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="sheet">
          <div className="sheet-head">
            <AlertDialog.Title>{account.slack.linked === false ? 'This account isn’t on Slack yet' : 'Open Hack Club Slack?'}</AlertDialog.Title>
            <AlertDialog.Description className="lead">
              If {account.email} isn’t on Slack yet, signing in through Hack Club creates a Hack Club Slack account for it and adds it to the workspace.
            </AlertDialog.Description>
          </div>
          <div className="dialog-actions">
            <AlertDialog.Cancel className="btn">Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              className="btn btn-primary"
              onClick={() => {
                onLaunch(account)
                onClose()
              }}
            >
              {account.slack.linked === false ? 'Create and open Slack' : 'Open Slack'}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

interface BulkProps {
  open: boolean
  accounts: Account[]
  onClose(): void
  onSignIn(accounts: Account[]): void
}

/** Before signing several accounts in to Slack when some might not be on it yet. */
export function SlackBulkDialog({ open, accounts, onClose, onSignIn }: BulkProps) {
  const fresh = accounts.filter((a) => a.slack.linked !== true)
  const on = accounts.filter((a) => a.slack.linked === true)
  const run = (list: Account[]) => () => {
    onSignIn(list)
    onClose()
  }
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="sheet">
          <div className="sheet-head">
            <AlertDialog.Title>
              Sign in to Slack on {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}?
            </AlertDialog.Title>
            <AlertDialog.Description className="lead">
              {fresh.length === accounts.length
                ? fresh.length === 1
                  ? 'It might not be on Slack yet. Signing in through Hack Club creates a Hack Club Slack account for it.'
                  : 'They might not be on Slack yet. Signing in through Hack Club creates Hack Club Slack accounts for them.'
                : `${fresh.length} of them might not be on Slack yet. Signing in through Hack Club creates Hack Club Slack accounts for them.`}
            </AlertDialog.Description>
          </div>
          <div className="dialog-actions">
            <AlertDialog.Cancel className="btn">Cancel</AlertDialog.Cancel>
            {on.length > 0 && (
              <AlertDialog.Action className="btn" onClick={run(on)}>
                Only {on.length} on Slack
              </AlertDialog.Action>
            )}
            <AlertDialog.Action className="btn btn-primary" onClick={run(accounts)}>
              {accounts.length === 1 ? 'Sign in' : `Sign in all ${accounts.length}`}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
