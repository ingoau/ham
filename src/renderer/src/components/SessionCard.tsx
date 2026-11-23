import type { Account } from '@shared/types'
import { LogOut } from 'lucide-react'
import { daysUntil, formatDate } from '../util'

function slackLabel(a: Account): string {
  if (a.slack.session) return 'Signed in'
  if (a.slack.linked) return 'Linked, not signed in'
  if (a.slack.linked === false) return 'Not on Slack yet'
  return 'Not signed in'
}

export function SessionCard({ account, onSignOut }: { account: Account; onSignOut(): void }) {
  const signedIn = account.status === 'signed-in'
  const days = daysUntil(account.expiresAt)
  return (
    <section className="card" aria-labelledby="session-heading">
      <h2 id="session-heading">Session on this computer</h2>
      <div className="facts three">
        <div>
          <div className="label">Status</div>
          <div className="value">{signedIn ? 'Signed in' : 'Signed out'}</div>
        </div>
        <div>
          <div className="label">{signedIn ? 'Renew sign-in by' : 'Ended'}</div>
          <div className="value">
            {formatDate(account.expiresAt)}
            {signedIn && days !== null && days <= 7 && days >= 0 && (
              <span style={{ color: 'var(--warn-text)', fontWeight: 400 }}> · {days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}</span>
            )}
          </div>
        </div>
        <div>
          <div className="label">Slack</div>
          <div className="value">{slackLabel(account)}</div>
        </div>
      </div>
      <div className="card-footer end">
        <button className="btn btn-danger" onClick={onSignOut}>
          <LogOut size={15} aria-hidden />
          {signedIn ? 'Sign out and remove' : 'Remove account'}
        </button>
      </div>
    </section>
  )
}
