import type { Account } from '@shared/types'
import { LogOut } from 'lucide-react'
import { daysUntil, formatDate } from '../util'

export function SessionCard({ account, onSignOut }: { account: Account; onSignOut(): void }) {
  const signedIn = account.status === 'signed-in'
  const days = daysUntil(account.expiresAt)
  return (
    <section className="card" aria-labelledby="session-heading">
      <h2 id="session-heading">Session on this computer</h2>
      <div className="facts">
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
      </div>
      <div className="card-footer">
        <span className="note">
          {signedIn
            ? 'Signing out ends this session on auth.hackclub.com and removes the account from HAM.'
            : 'Removing the account deletes its data from this computer.'}
        </span>
        <button className="btn btn-danger" onClick={onSignOut}>
          <LogOut size={15} aria-hidden />
          {signedIn ? 'Sign out and remove' : 'Remove account'}
        </button>
      </div>
    </section>
  )
}
