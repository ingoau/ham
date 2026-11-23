import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, ChevronDown, Pin, Plus, Search, Settings, SlidersHorizontal, X } from 'lucide-react'
import type { Account, ViewSettings } from '@shared/types'
import { badgeFor, type GroupModel, type RowModel } from '../view'
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
  draggable: boolean
  accounts: Account[]
  selectedId: string | null
  picked: Set<string>
  inboxOn: boolean
  mod: string
  view: ViewSettings
  progress: BulkProgress | null
  onCancelProgress(): void
  onView(view: ViewSettings): void
  /** Open an account (a plain click clears any selection). */
  onSelect(id: string): void
  onTogglePick(id: string, range: boolean): void
  /** Shift+arrow: extend the selection to this account. */
  onExtendTo(id: string): void
  onSelectAll(): void
  onClearPicked(): void
  /** New manual order for the two draggable sections, and a pin change for a cross-section drop. */
  onReorder(pinned: string[], rest: string[], pinChange: { id: string; pinned: boolean } | null): void
  onContextMenu(account: Account): void
  onAdd(): void
  onOpenPalette(): void
  onOpenSettings(): void
}

interface RowProps {
  row: RowModel
  draggable: boolean
  showSub: boolean
  checked: boolean
  current: boolean
  inboxOn: boolean
  onRowClick(e: MouseEvent, id: string): void
  onCheck(e: MouseEvent, id: string): void
  onRowKey(e: KeyboardEvent, id: string): void
  onContextMenu(e: MouseEvent, account: Account): void
}

function AccountRow({ row, draggable, showSub, checked, current, inboxOn, onRowClick, onCheck, onRowKey, onContextMenu }: RowProps) {
  const { account: a, title, sub } = row
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: a.id, disabled: !draggable })
  const badge = badgeFor(a, inboxOn)
  const hasSub = !(a.status === 'signed-in' || a.status === 'signed-out') || showSub
  return (
    <div
      ref={setNodeRef}
      className={`account-row${checked ? ' checked' : ''}${isDragging ? ' dragging' : ''}`}
      aria-current={current ? 'true' : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onContextMenu={(e) => onContextMenu(e, a)}
      {...listeners}
    >
      <button className="row-check" role="checkbox" aria-checked={checked} aria-label={`Select ${title}`} tabIndex={-1} onClick={(e) => onCheck(e, a.id)}>
        <span className="row-avatar">
          <Avatar account={a} size={34} />
        </span>
        <span className="checkbox" aria-hidden>
          {checked && <Check size={14} strokeWidth={3} />}
        </span>
      </button>
      <button id={`account-${a.id}`} className="row-main" onClick={(e) => onRowClick(e, a.id)} onKeyDown={(e) => onRowKey(e, a.id)}>
        <span className="meta">
          <span className="name">{title}</span>
          {hasSub && <span className="email">{sub}</span>}
        </span>
        {a.pinned && !badge && <Pin size={12} className="pin-mark" aria-label="Pinned" />}
        {badge && <span className={`badge tone-${badge.tone}`}>{badge.label}</span>}
      </button>
    </div>
  )
}

export function Sidebar(props: Props) {
  const { groups, showSub, order, draggable, accounts, selectedId, picked, inboxOn, mod, view, progress } = props
  const picking = picked.size > 0
  const [dragging, setDragging] = useState(false)
  // A small threshold so clicks and right-clicks never start a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const focusRow = (id: string) => document.getElementById(`account-${id}`)?.focus()

  const onRowKey = (e: KeyboardEvent, id: string) => {
    if (e.key === ' ') {
      e.preventDefault()
      props.onTogglePick(id, false)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (e.altKey || e.metaKey || e.ctrlKey) return // menu shortcuts (move up/down)
    e.preventDefault()
    const i = order.indexOf(id)
    const next = order[e.key === 'ArrowDown' ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1)]
    if (!next || next === id) return
    if (e.shiftKey) props.onExtendTo(next)
    else props.onSelect(next)
    focusRow(next)
  }

  const onRowClick = (e: MouseEvent, id: string) => {
    if (e.metaKey || e.ctrlKey) return props.onTogglePick(id, false)
    if (e.shiftKey) return props.onTogglePick(id, true)
    props.onSelect(id)
  }

  const onContextMenu = (e: MouseEvent, account: Account) => {
    e.preventDefault()
    props.onContextMenu(account)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false)
    if (!over || active.id === over.id) return
    const pinnedIds = groups.find((g) => g.pinned)?.rows.map((r) => r.account.id) ?? []
    const restIds = groups.find((g) => !g.pinned)?.rows.map((r) => r.account.id) ?? []
    const from = pinnedIds.includes(String(active.id)) ? 'pinned' : 'rest'
    // Dropping on a section header lands at the end of that section.
    const overId = String(over.id)
    const to = overId === 'section:pinned' || pinnedIds.includes(overId) ? 'pinned' : 'rest'
    const lists = { pinned: [...pinnedIds], rest: [...restIds] }
    if (from === to) {
      const list = lists[from]
      lists[from] = arrayMove(list, list.indexOf(String(active.id)), Math.max(0, list.indexOf(overId)))
      props.onReorder(lists.pinned, lists.rest, null)
    } else {
      lists[from] = lists[from].filter((x) => x !== String(active.id))
      const at = lists[to].indexOf(overId)
      lists[to].splice(at === -1 ? lists[to].length : at, 0, String(active.id))
      props.onReorder(lists.pinned, lists.rest, { id: String(active.id), pinned: to === 'pinned' })
    }
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

      <nav className={`account-list${picking ? ' picking' : ''}${dragging ? ' is-dragging' : ''}`} aria-label="Accounts">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={() => setDragging(true)}
          onDragCancel={() => setDragging(false)}
          onDragEnd={onDragEnd}
        >
          {groups.map((g) => {
            // An empty section is only a drop target while dragging.
            if (g.rows.length === 0 && !dragging) return null
            const ids = g.rows.map((r) => r.account.id)
            return (
              <div key={g.key || 'all'} role="group" aria-label={g.name || undefined} className="account-group">
                {g.name !== '' && (
                  <SectionHeader
                    id={g.pinned ? 'section:pinned' : g.key === '' ? 'section:rest' : `group:${g.key}`}
                    droppable={draggable}
                    group={g}
                    onToggle={() => props.onView({ ...view, collapsed: { ...view.collapsed, [g.key || 'accounts']: g.open } })}
                  />
                )}
                {g.open && (
                  <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={!draggable}>
                    {g.rows.map((r) => (
                      <AccountRow
                        key={r.account.id}
                        row={r}
                        draggable={draggable}
                        showSub={showSub}
                        checked={picked.has(r.account.id)}
                        current={r.account.id === selectedId && !picking}
                        inboxOn={inboxOn}
                        onRowClick={onRowClick}
                        onCheck={(e, id) => props.onTogglePick(id, e.shiftKey)}
                        onRowKey={onRowKey}
                        onContextMenu={onContextMenu}
                      />
                    ))}
                  </SortableContext>
                )}
              </div>
            )
          })}
        </DndContext>
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

function SectionHeader({ id, droppable, group, onToggle }: { id: string; droppable: boolean; group: GroupModel; onToggle(): void }) {
  // Section headers are drop targets (the end of that section) for cross-section drags.
  const { setNodeRef, isOver } = useSortable({ id, disabled: { draggable: true, droppable: !droppable } })
  return (
    <button ref={setNodeRef} className={`group-header${isOver ? ' drop-target' : ''}`} aria-expanded={group.open} onClick={onToggle}>
      <ChevronDown size={14} aria-hidden style={{ transform: group.open ? undefined : 'rotate(-90deg)' }} />
      {group.pinned && <Pin size={11} aria-hidden />}
      <span className="group-name">{group.name}</span>
      <span className="group-count">{group.rows.length}</span>
    </button>
  )
}
