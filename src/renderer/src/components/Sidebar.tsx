import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
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
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { Check, ChevronDown, ListFilter, Pin, Plus, Search, Settings, SlidersHorizontal, X } from 'lucide-react'
import { EMPTY_FILTER, type Account, type AccountFilter, type AccountTag, type ViewSettings } from '@shared/types'
import { useStableCallback } from '../hooks'
import type { BulkProgress } from '../useBulkJob'
import { badgeFor, filterCount as countFilters, statusText, type GroupModel, type RowModel } from '../view'
import { Avatar } from './Avatar'
import { FilterMenu } from './FilterMenu'
import { TagDots } from './Tags'
import { Ticking } from './Ticking'
import { ViewOptions } from './ViewOptions'

/** A drop into another section: pin it, or move it into a group (null: ungrouped). */
export type SectionMove = { id: string; pinned: true } | { id: string; pinned: false; groupId: string | null }

export type { BulkProgress }

/** Past this many rows the list only renders what's on screen (and drag reordering is off). */
export const VIRTUAL_AFTER = 200

interface Props {
  groups: GroupModel[]
  showSub: boolean
  order: string[]
  /** Ids the filter lets through. */
  visible: string[]
  filtering: boolean
  draggable: boolean
  accounts: Account[]
  tags: AccountTag[]
  filterOpen: boolean
  onFilterOpen(open: boolean): void
  onFilter(filter: AccountFilter): void
  onNewTag(): void
  onTagMenu(tag: AccountTag): void
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
  /** Every tag: the row picks its own, so the prop stays the same between renders. */
  tags: AccountTag[]
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

const AccountRow = memo(function AccountRow({ row, tags, draggable, showSub, checked, current, inboxOn, onRowClick, onCheck, onRowKey, onContextMenu }: RowProps) {
  const { account: a, title, sub } = row
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: a.id, disabled: !draggable })
  const badge = badgeFor(a, inboxOn)
  const own = useMemo(() => tags.filter((t) => a.tagIds.includes(t.id)), [tags, a.tagIds])
  const hasSub = !(a.status === 'signed-in' || a.status === 'signed-out') || showSub
  // Countdowns tick in their own leaf, not through the whole list.
  const live = a.status === 'waiting' || a.status === 'needs2fa' || a.status === 'queued'
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
          <span className="name-line">
            <span className="name">{title}</span>
            <TagDots tags={own} />
          </span>
          {hasSub && <span className="email">{live ? <Ticking>{(now) => statusText(a, inboxOn, now)}</Ticking> : sub}</span>}
        </span>
        {a.pinned && !badge && <Pin size={12} className="pin-mark" aria-label="Pinned" />}
        {badge && <span className={`badge tone-${badge.tone}`}>{badge.label}</span>}
      </button>
    </div>
  )
})

/** One line of the list: a section header, an empty section's hint, or an account. */
type Item =
  | { kind: 'header'; key: string; group: GroupModel }
  | { kind: 'empty'; key: string; group: GroupModel }
  | { kind: 'row'; key: string; group: GroupModel; row: RowModel }

/** The sections as one flat list, the way they show on screen. */
export function listItems(groups: GroupModel[], dragging: boolean, filtering: boolean): Item[] {
  const items: Item[] = []
  for (const g of groups) {
    // An empty section is only a drop target while dragging (your own groups show unless filtering).
    if (g.rows.length === 0 && !dragging && (!g.groupId || filtering)) continue
    if (g.name !== '') items.push({ kind: 'header', key: sectionId(g), group: g })
    if (!g.open) continue
    if (g.rows.length === 0 && !dragging) items.push({ kind: 'empty', key: `empty:${sectionId(g)}`, group: g })
    for (const row of g.rows) items.push({ kind: 'row', key: row.account.id, group: g, row })
  }
  return items
}

const ESTIMATE = { header: 31, empty: 34, row: 56 }

export function Sidebar(props: Props) {
  const { groups, showSub, order, visible, filtering, accounts, tags, selectedId, picked, inboxOn, mod, view, progress } = props
  const filterCount = countFilters(view.filter, new Set(tags.map((t) => t.id)))
  const picking = picked.size > 0
  const [dragging, setDragging] = useState(false)
  // A small threshold so clicks and right-clicks never start a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const allItems = useMemo(() => listItems(groups, dragging, filtering), [groups, dragging, filtering])
  const rowCount = useMemo(() => allItems.reduce((n, it) => n + (it.kind === 'row' ? 1 : 0), 0), [allItems])
  const virtual = rowCount > VIRTUAL_AFTER
  // Nothing drags in a long list, so an empty section has no drop hint there.
  const items = useMemo(() => (virtual ? allItems.filter((it) => it.kind !== 'empty') : allItems), [allItems, virtual])
  // dnd-kit can't drag between rows that aren't rendered, so long lists don't drag (Move Up/Down still work).
  const draggable = props.draggable && !virtual
  const listRef = useRef<HTMLElement>(null)
  const indexOf = useMemo(() => new Map(items.map((it, i) => [it.key, i])), [items])
  const selectedIndex = selectedId ? (indexOf.get(selectedId) ?? -1) : -1
  const virtualizer = useVirtualizer({
    enabled: virtual,
    count: virtual ? items.length : 0,
    getScrollElement: () => listRef.current,
    estimateSize: (i) => ESTIMATE[items[i].kind],
    getItemKey: (i) => items[i].key,
    // Keep the open account's row rendered so keyboard focus survives scrolling.
    rangeExtractor: (range: Range) => {
      const shown = defaultRangeExtractor(range)
      return selectedIndex >= 0 && selectedIndex < range.count && !shown.includes(selectedIndex) ? [...shown, selectedIndex].sort((a, b) => a - b) : shown
    },
    overscan: 10,
    gap: 2,
    paddingStart: 4,
    paddingEnd: 4,
    initialRect: { width: 0, height: 800 }
  })

  // A row that isn't rendered yet gets focus once it is (after scrolling to it).
  const pendingFocus = useRef<string | null>(null)
  useEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    const el = document.getElementById(`account-${id}`)
    if (el) {
      pendingFocus.current = null
      el.focus()
    }
  })

  // Long lists: bring the open account into view when the selection changes (arrow keys,
  // the palette, ⌘1…), not when it only moves (a section above collapsing, a re-sort).
  const scrolledTo = useRef<string | null>(null)
  useEffect(() => {
    if (!virtual || selectedIndex < 0 || scrolledTo.current === selectedId) return
    scrolledTo.current = selectedId
    virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
  }, [virtual, selectedId, selectedIndex, virtualizer])

  const focusRow = (id: string) => {
    const el = document.getElementById(`account-${id}`)
    if (el) return el.focus()
    const i = indexOf.get(id)
    if (virtual && i !== undefined) {
      pendingFocus.current = id
      virtualizer.scrollToIndex(i, { align: 'auto' })
    }
  }

  const onRowKey = useStableCallback((e: KeyboardEvent, id: string) => {
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
  })

  const onRowClick = useStableCallback((e: MouseEvent, id: string) => {
    if (e.metaKey || e.ctrlKey) return props.onTogglePick(id, false)
    if (e.shiftKey) return props.onTogglePick(id, true)
    props.onSelect(id)
  })

  const onCheck = useStableCallback((e: MouseEvent, id: string) => props.onTogglePick(id, e.shiftKey))

  const onContextMenu = useStableCallback((e: MouseEvent, account: Account) => {
    e.preventDefault()
    props.onContextMenu(account)
  })

  const renderRow = (r: RowModel) => (
    <AccountRow
      key={r.account.id}
      row={r}
      tags={tags}
      draggable={draggable}
      showSub={showSub}
      checked={picked.has(r.account.id)}
      current={r.account.id === selectedId && !picking}
      inboxOn={inboxOn}
      onRowClick={onRowClick}
      onCheck={onCheck}
      onRowKey={onRowKey}
      onContextMenu={onContextMenu}
    />
  )

  const renderHeader = (g: GroupModel) => (
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
  )

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
          <FilterMenu
            open={props.filterOpen}
            onOpenChange={props.onFilterOpen}
            filter={view.filter}
            tags={tags}
            accounts={accounts}
            onChange={props.onFilter}
            onNewTag={props.onNewTag}
            onTagMenu={props.onTagMenu}
          >
            <button data-filter-button className={`icon-btn${filtering ? ' active' : ''}`} aria-label={filtering ? `Filter (${filterCount} on)` : 'Filter'}>
              <ListFilter size={16} aria-hidden />
              {filtering && <span className="icon-badge" aria-hidden>{filterCount}</span>}
            </button>
          </FilterMenu>
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

      {filtering && (
        <div className="filter-bar" role="status">
          <span>
            Showing {visible.length} of {accounts.length}
          </span>
          <button className="btn-link strong inline" onClick={() => props.onFilter(EMPTY_FILTER)}>
            Clear filter
          </button>
        </div>
      )}

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

      <nav ref={listRef} className={`account-list${picking ? ' picking' : ''}${dragging ? ' is-dragging' : ''}${virtual ? ' virtual' : ''}`} aria-label="Accounts">
        {virtual ? (
          <div className="virtual-items" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const it = items[v.index]
              return (
                <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className="virtual-item" style={{ transform: `translateY(${v.start}px)` }}>
                  {it.kind === 'header' ? renderHeader(it.group) : it.kind === 'row' ? renderRow(it.row) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={() => setDragging(true)}
            onDragCancel={() => setDragging(false)}
            onDragEnd={onDragEnd}
          >
            {groups.map((g) => {
              // An empty section is only a drop target while dragging (your own groups show unless filtering).
              if (g.rows.length === 0 && !dragging && (!g.groupId || filtering)) return null
              const ids = g.rows.map((r) => r.account.id)
              return (
                <div key={g.key || 'all'} role="group" aria-label={g.name || undefined} className="account-group">
                  {g.name !== '' && renderHeader(g)}
                  {g.open && g.rows.length === 0 && !dragging && <p className="group-empty">Drag accounts here</p>}
                  {g.open && (
                    <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={!draggable}>
                      {g.rows.map(renderRow)}
                    </SortableContext>
                  )}
                </div>
              )
            })}
          </DndContext>
        )}
        {filtering && visible.length === 0 && <p className="list-empty">No accounts match this filter.</p>}
      </nav>

      <div className="sidebar-footer">
        {picking ? (
          <div className="selection-bar">
            <div className="selection-top">
              <span className="selection-count">{picked.size} selected</span>
              <button className="btn-link strong inline" onClick={props.onSelectAll}>
                {visible.length > 0 && visible.every((id) => picked.has(id)) ? 'Select none' : 'Select all'}
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
