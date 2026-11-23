import { forwardRef, type KeyboardEvent } from 'react'
import type { Account } from '@shared/types'
import { PlusIcon, SearchIcon } from '../icons'
import { displayName, matches } from '../util'
import { Avatar } from './Avatar'

interface Props {
  accounts: Account[]
  selectedId: string | null
  query: string
  onQuery(q: string): void
  onSelect(id: string): void
  onAdd(): void
}

export const Sidebar = forwardRef<HTMLInputElement, Props>(function Sidebar(
  { accounts, selectedId, query, onQuery, onSelect, onAdd },
  searchRef
) {
  const shown = accounts.filter((a) => matches(a, query))

  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = shown.findIndex((a) => a.id === selectedId)
    const next = shown[e.key === 'ArrowDown' ? Math.min(shown.length - 1, i + 1) : Math.max(0, i - 1)]
    if (next) {
      onSelect(next.id)
      document.getElementById(`account-${next.id}`)?.focus()
    }
  }

  return (
    <aside className="sidebar">
      <div className="titlebar">
        <span className="brand">HAM</span>
        <div className="search">
          <label htmlFor="search" className="visually-hidden">
            Search accounts
          </label>
          <SearchIcon size={13} />
          <input
            id="search"
            ref={searchRef}
            type="search"
            placeholder="Search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onQuery('')
              if (e.key === 'ArrowDown' && shown[0]) {
                e.preventDefault()
                onSelect(shown[0].id)
                document.getElementById(`account-${shown[0].id}`)?.focus()
              }
            }}
          />
        </div>
      </div>

      <nav className="account-list" aria-label="Accounts" onKeyDown={onListKey}>
        {shown.map((a) => (
          <button
            key={a.id}
            id={`account-${a.id}`}
            className="account-row"
            aria-current={a.id === selectedId ? 'true' : 'false'}
            onClick={() => onSelect(a.id)}
          >
            <Avatar account={a} size={34} />
            <span className="meta">
              <span className="name">{displayName(a)}</span>
              <span className="email">{a.email}</span>
            </span>
            {a.status === 'signed-out' && <span className="pill-warn">Signed out</span>}
          </button>
        ))}
        {accounts.length > 0 && shown.length === 0 && <p className="list-empty">No accounts match “{query}”.</p>}
      </nav>

      <div className="sidebar-footer">
        <button className="btn btn-block" onClick={onAdd}>
          <PlusIcon />
          Add account
        </button>
      </div>
    </aside>
  )
})
