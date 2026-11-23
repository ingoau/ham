import type { ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, Ellipsis, Plus } from 'lucide-react'
import { EMPTY_FILTER, NO_TAGS, type Account, type AccountFilter, type AccountTag, type StatusFilter } from '@shared/types'
import { STATUS_FILTERS, filterActive, statusBucket } from '../view'
import { TagDot } from './Tags'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  filter: AccountFilter
  tags: AccountTag[]
  accounts: Account[]
  onChange(filter: AccountFilter): void
  onNewTag(): void
  /** Edit or delete a tag (a native menu). */
  onTagMenu(tag: AccountTag): void
  children: ReactNode
}

function CheckRow({ checked, onToggle, children, count, extra }: { checked: boolean; onToggle(): void; children: ReactNode; count: number; extra?: ReactNode }) {
  return (
    <div className="filter-item">
      <button className="filter-check" role="checkbox" aria-checked={checked} onClick={onToggle}>
        <span className={`checkbox${checked ? ' on' : ''}`} aria-hidden>
          {checked && <Check size={12} strokeWidth={3} />}
        </span>
        <span className="filter-label">{children}</span>
        <span className="filter-count">{count}</span>
      </button>
      {extra}
    </div>
  )
}

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

/** The sidebar's filter: by tags (any or all) and by status. */
export function FilterMenu({ open, onOpenChange, filter, tags, accounts, onChange, onNewTag, onTagMenu, children }: Props) {
  const set = (patch: Partial<AccountFilter>) => onChange({ ...filter, ...patch })
  const known = new Set(tags.map((t) => t.id))
  const withTag = (id: string) => accounts.filter((a) => a.tagIds.includes(id)).length
  const untagged = accounts.filter((a) => !a.tagIds.some((t) => known.has(t))).length
  const inStatus = (s: StatusFilter) => accounts.filter((a) => statusBucket(a) === s).length
  const realTags = filter.tags.filter((t) => t !== NO_TAGS && known.has(t)).length

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover filter-menu" side="bottom" align="start" sideOffset={6} collisionPadding={12}>
          <section className="filter-section" aria-labelledby="filter-tags">
            <div className="filter-head">
              <h3 id="filter-tags">Tags</h3>
              {realTags > 1 && (
                <div className="segmented small" role="radiogroup" aria-label="Match">
                  <button className="seg" role="radio" aria-checked={filter.tagMode === 'any'} onClick={() => set({ tagMode: 'any' })}>
                    Any
                  </button>
                  <button className="seg" role="radio" aria-checked={filter.tagMode === 'all'} onClick={() => set({ tagMode: 'all' })}>
                    All
                  </button>
                </div>
              )}
            </div>
            {tags.length === 0 && <p className="filter-empty">Tag accounts to sort them more than one way. Right-click an account, or make one here.</p>}
            {tags.map((t) => (
              <CheckRow
                key={t.id}
                checked={filter.tags.includes(t.id)}
                onToggle={() => set({ tags: toggle(filter.tags, t.id) })}
                count={withTag(t.id)}
                extra={
                  <button className="icon-btn small filter-more" aria-label={`Edit ${t.name}`} aria-haspopup="menu" onClick={() => onTagMenu(t)}>
                    <Ellipsis size={14} aria-hidden />
                  </button>
                }
              >
                <span className="filter-tag" onContextMenu={(e) => (e.preventDefault(), onTagMenu(t))}>
                  <TagDot tag={t} />
                  {t.name}
                </span>
              </CheckRow>
            ))}
            {tags.length > 0 && (
              <CheckRow checked={filter.tags.includes(NO_TAGS)} onToggle={() => set({ tags: toggle(filter.tags, NO_TAGS) })} count={untagged}>
                <span className="muted">No tags</span>
              </CheckRow>
            )}
            <button className="filter-new" onClick={onNewTag}>
              <Plus size={14} aria-hidden />
              New tag
            </button>
          </section>
          <section className="filter-section" aria-labelledby="filter-status">
            <div className="filter-head">
              <h3 id="filter-status">Status</h3>
            </div>
            {STATUS_FILTERS.map(([s, label]) => (
              <CheckRow key={s} checked={filter.status.includes(s)} onToggle={() => set({ status: toggle(filter.status, s) })} count={inStatus(s)}>
                {label}
              </CheckRow>
            ))}
          </section>
          <div className="view-foot">
            <button className="btn-link strong inline" disabled={!filterActive(filter)} onClick={() => onChange(EMPTY_FILTER)}>
              Clear filter
            </button>
            <Popover.Close className="btn btn-small">Done</Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
