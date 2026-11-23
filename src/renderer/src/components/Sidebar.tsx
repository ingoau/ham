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

/** A drop into another section: pin it, or move it into a group (null: ungrouped). */
export type SectionMove = { id: string; pinned: true } | { id: string; pinned: false; groupId: string | null }

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
  /** New manual order (every account, top to bottom) and where a cross-section drop landed. */
  onReorder(ids: string[], moved: SectionMove | null): void
  onContextMenu(account: Account): void
  onGroupMenu(group: GroupModel): void
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
    const id = String(active.id)
    const overId = String(over.id)
    const lists = groups.map((g) => g.rows.map((r) => r.account.id))
    const from = lists.findIndex((l) => l.includes(id))
    // Dropping on a section header lands at the end of that section.
    const to = groups.findIndex((g, i) => sectionId(g) === overId || lists[i].includes(overId))
    if (from === -1 || to === -1) return
    if (from === to) {
      lists[from] = arrayMove(lists[from], lists[from].indexOf(id), Math.max(0, lists[from].indexOf(overId)))
      return props.onReorder(lists.flat(), null)
    }
    lists[from] = lists[from].filter((x) => x !== id)
    const at = lists[to].indexOf(overId)
    lists[to].splice(at === -1 ? lists[to].length : at, 0, id)
    const target = groups[to]
    props.onReorder(lists.flat(), target.pinned ? { id, pinned: true } : { id, pinned: false, groupId: target.groupId ?? null })
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
            // An empty section is only a drop target while dragging (your own groups always show).
            if (g.rows.length === 0 && !dragging && !g.groupId) return null
            const ids = g.rows.map((r) => r.account.id)
            return (
              <div key={g.key || 'all'} role="group" aria-label={g.name || undefined} className="account-group">
                {g.name !== '' && (
                  <SectionHeader
                    id={sectionId(g)}
                    droppable={draggable}
                    group={g}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      props.onGroupMenu(g)
                    }}
                    onToggle={() => props.onView({ ...view, collapsed: { ...view.collapsed, [g.key || 'accounts']: g.open } })}
                  />
                )}
                {g.open && g.rows.length === 0 && !dragging && <p className="group-empty">Drag accounts here</p>}
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

const sectionId = (g: GroupModel) => `section:${g.key || 'rest'}`

function SectionHeader({
  id,
  droppable,
  group,
  onToggle,
  onContextMenu
}: {
  id: string
  droppable: boolean
  group: GroupModel
  onToggle(): void
  onContextMenu(e: MouseEvent): void
}) {
  // Section headers are drop targets (the end of that section) for cross-section drags.
  const { setNodeRef, isOver } = useSortable({ id, disabled: { draggable: true, droppable: !droppable } })
  return (
    <button
      ref={setNodeRef}
      className={`group-header${isOver ? ' drop-target' : ''}`}
      aria-expanded={group.open}
      onClick={onToggle}
      onContextMenu={onContextMenu}
    >
      <ChevronDown size={14} aria-hidden style={{ transform: group.open ? undefined : 'rotate(-90deg)' }} />
      {group.pinned && <Pin size={11} aria-hidden />}
      <span className="group-name">{group.name}</span>
      <span className="group-count">{group.rows.length}</span>
    </button>
  )
}
