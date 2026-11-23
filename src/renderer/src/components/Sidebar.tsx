import type { KeyboardEvent } from 'react'
import { Plus, Search } from 'lucide-react'
import type { Account } from '@shared/types'
import { displayName } from '../util'
import { Avatar } from './Avatar'

interface Props {
  accounts: Account[]
  selectedId: string | null
  /** The shortcut modifier shown in hints: "⌘" on macOS, "Ctrl+" elsewhere. */
  mod: string
  onSelect(id: string): void
  onAdd(): void
  onOpenPalette(): void
}

export function Sidebar({ accounts, selectedId, mod, onSelect, onAdd, onOpenPalette }: Props) {
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = accounts.findIndex((a) => a.id === selectedId)
    const next = accounts[e.key === 'ArrowDown' ? Math.min(accounts.length - 1, i + 1) : Math.max(0, i - 1)]
    if (next) {
      onSelect(next.id)
      document.getElementById(`account-${next.id}`)?.focus()
    }
  }

  return (
    <aside className="sidebar">
      <div className="titlebar">
        <span className="brand">HAM</span>
      </div>
      <div className="search-row">
        <button className="search-button" onClick={onOpenPalette} aria-keyshortcuts={mod === '⌘' ? 'Meta+K' : 'Control+K'}>
          <Search size={14} aria-hidden />
          <span className="search-label">Search accounts and actions</span>
          <kbd>{mod}K</kbd>
        </button>
      </div>

      <nav className="account-list" aria-label="Accounts" onKeyDown={onListKey}>
        {accounts.map((a) => (
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
      </nav>

      <div className="sidebar-footer">
        <button className="btn btn-block" onClick={onAdd}>
          <Plus size={16} aria-hidden />
          Add account
        </button>
      </div>
    </aside>
  )
}
