import { isPending, type Account } from '@shared/types'
import { avatarColor, initials } from '../util'

/** Accounts still being added get a grey avatar with their email's initial. */
export function Avatar({ account, size }: { account: Account; size: number }) {
  const pending = isPending(account.status)
  const text = account.fresh && pending ? account.email.charAt(0).toUpperCase() : initials(account)
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: pending ? 'var(--pending-avatar)' : avatarColor(account.id) }}
    >
      {text}
    </span>
  )
}
