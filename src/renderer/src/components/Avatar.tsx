import type { Account } from '@shared/types'
import { avatarColor, initials } from '../util'

export function Avatar({ account, size }: { account: Account; size: number }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: avatarColor(account.id) }}
    >
      {initials(account)}
    </span>
  )
}
