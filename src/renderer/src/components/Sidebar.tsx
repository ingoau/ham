import type { KeyboardEvent, MouseEvent } from 'react'
import { Check, ChevronDown, Plus, Search, Settings, SlidersHorizontal, X } from 'lucide-react'
import type { Account, ViewSettings } from '@shared/types'
import { badgeFor, type GroupModel } from '../view'
import { Avatar } from './Avatar'
import { ViewOptions } from './ViewOptions'

export interface BulkProgress {
  label: string
  done: number
  total: number
  cancelling?: boolean
}

interface Props {
  groups: GroupModel[]
  showSub: boolean
  order: string[]
  accounts: Account[]
  selectedId: string | null
  picked: Set<string>
  inboxOn: boolean
  mod: string
  view: ViewSettings
  progress: BulkProgress | null
  onCancelProgress(): void
  onView(view: ViewSettings): void
  onSelect(id: string): void
  onTogglePick(id: string, range: boolean): void
  onSelectAll(): void
  onClearPicked(): void
  onBulkEdit(): void
  onSignInAgain(): void
  onAdd(): void
  onOpenPalette(): void
  onOpenSettings(): void
}

export function Sidebar(props: Props) {
  const { groups, showSub, order, accounts, selectedId, picked, inboxOn, mod, view, progress } = props
  const picking = picked.size > 0
  const pickedSignedOut = accounts.some((a) => picked.has(a.id) && a.status === 'signed-out')

  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = order.indexOf(selectedId ?? '')
    const next = order[e.key === 'ArrowDown' ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1)]
    if (next) {
      props.onSelect(next)
      document.getElementById(`account-${next}`)?.focus()
    }
  }

  const onRowClick = (e: MouseEvent, id: string) => {
    if (e.metaKey || e.ctrlKey) return props.onTogglePick(id, false)
    if (e.shiftKey && picking) return props.onTogglePick(id, true)
    props.onSelect(id)
  }

  return (
    <aside className="sidebar">
      <div className="titlebar">
        <span className="brand">HAM</span>
        <span className="titlebar-actions">
          <ViewOptions view={view} onChange={props.onView}>
            <button className="icon-btn" aria-label="View options">
              <SlidersHorizontal size={16} aria-hidden />
            </button>
          </ViewOptions>
          <button className="icon-btn" aria-label="Settings" onClick={props.onOpenSettings}>
            <Settings size={16} aria-hidden />
          </button>
        </span>
      </div>
      <div className="search-row">
        <button className="search-button" onClick={props.onOpenPalette} aria-keyshortcuts={mod === '⌘' ? 'Meta+K' : 'Control+K'}>
          <Search size={14} aria-hidden />
          <span className="search-label">Search accounts and actions</span>
          <kbd>{mod}K</kbd>
        </button>
      </div>

      {progress && (
        <div className="progress-card" role="status">
          <div className="progress-head">
            <span className="progress-text">
              {progress.label} · {progress.done} of {progress.total}
            </span>
            <button className="btn-link inline" disabled={progress.cancelling} onClick={props.onCancelProgress}>
              {progress.cancelling ? 'Stopping…' : 'Cancel'}
            </button>
          </div>
          <div className="progress-bar">
            <span style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
          </div>
        </div>
      )}

      <nav className={`account-list${picking ? ' picking' : ''}`} aria-label="Accounts" onKeyDown={onListKey}>
        {groups.map((g) => (
          <div key={g.key || 'all'} role="group" aria-label={g.name || undefined}>
            {g.name !== '' && (
              <button
                className="group-header"
                aria-expanded={g.open}
                onClick={() => props.onView({ ...view, collapsed: { ...view.collapsed, [g.key]: g.open } })}
              >
                <ChevronDown size={14} aria-hidden style={{ transform: g.open ? undefined : 'rotate(-90deg)' }} />
                <span className="group-name">{g.name}</span>
                <span className="group-count">{g.rows.length}</span>
              </button>
            )}
            {g.open &&
              g.rows.map(({ account: a, title, sub }) => {
                const badge = badgeFor(a, inboxOn)
                const checked = picked.has(a.id)
                const hasSub = !(a.status === 'signed-in' || a.status === 'signed-out') || showSub
                return (
                  <div
                    key={a.id}
                    className={`account-row${checked ? ' checked' : ''}`}
                    aria-current={a.id === selectedId ? 'true' : undefined}
                  >
                    <button
                      className="row-check"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`Select ${title}`}
                      onClick={(e) => props.onTogglePick(a.id, e.shiftKey)}
                    >
                      <span className="row-avatar">
                        <Avatar account={a} size={34} />
                      </span>
                      <span className="checkbox" aria-hidden>
                        {checked && <Check size={14} strokeWidth={3} />}
                      </span>
                    </button>
                    <button id={`account-${a.id}`} className="row-main" onClick={(e) => onRowClick(e, a.id)}>
                      <span className="meta">
                        <span className="name">{title}</span>
                        {hasSub && <span className="email">{sub}</span>}
                      </span>
                      {badge && <span className={`badge tone-${badge.tone}`}>{badge.label}</span>}
                    </button>
                  </div>
                )
              })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {picking ? (
          <div className="selection-bar">
            <div className="selection-top">
              <span className="selection-count">{picked.size} selected</span>
              <button className="btn-link strong inline" onClick={props.onSelectAll}>
                {picked.size === accounts.length ? 'Select none' : 'Select all'}
              </button>
              <button className="icon-btn" aria-label="Clear selection" onClick={props.onClearPicked}>
                <X size={15} aria-hidden />
              </button>
            </div>
            <div className="selection-actions">
              <button className="btn btn-primary" onClick={props.onBulkEdit}>
                Bulk edit
              </button>
              <button className="btn" disabled={!pickedSignedOut} onClick={props.onSignInAgain}>
                Sign in again
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-block" onClick={props.onAdd}>
            <Plus size={16} aria-hidden />
            Add account
          </button>
        )}
      </div>
    </aside>
  )
}
