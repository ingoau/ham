import { useEffect, useState } from 'react'
import type { Account } from '@shared/types'
import { displayName } from '../util'

/** A name only HAM shows. Saves when the field loses focus or on Enter. */
export function LocalNameCard({ account }: { account: Account }) {
  const [value, setValue] = useState(account.localName)
  useEffect(() => setValue(account.localName), [account.id, account.localName])

  const commit = () => {
    const clean = value.replace(/\s+/g, ' ').trim()
    setValue(clean)
    if (clean !== account.localName) void window.ham.accounts.setLocalName(account.id, clean)
  }

  return (
    <section className="card" aria-labelledby="local-heading">
      <div>
        <h2 id="local-heading">Local name</h2>
        <p className="lead" id="local-lead">
          Only kept in HAM, never sent to Hack Club. The list shows it ahead of Slack and Hack Club names.
        </p>
      </div>
      <div className="field">
        <input
          id="local-name"
          aria-labelledby="local-heading"
          aria-describedby="local-lead"
          value={value}
          maxLength={60}
          placeholder={displayName(account)}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape' && value !== account.localName) {
              e.preventDefault()
              e.stopPropagation()
              setValue(account.localName)
            }
          }}
        />
      </div>
    </section>
  )
}
