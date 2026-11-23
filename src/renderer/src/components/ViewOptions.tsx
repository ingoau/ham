import type { ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { GroupBy, LineKind, SortBy, ViewSettings } from '@shared/types'
import { emptyContext } from '../bulk'
import { useTemplates } from '../templates'
import { sortDirLabel } from '../view'
import { TemplateInput } from './TemplateInput'

const SORTS: [SortBy, string][] = [
  ['manual', 'Manual'],
  ['line1', 'First line'],
  ['hca', 'Hack Club name'],
  ['sdisplay', 'Slack display name'],
  ['email', 'Email'],
  ['added', 'Date added'],
  ['status', 'Needs attention']
]
const GROUPS: [GroupBy, string][] = [
  ['none', 'My groups'],
  ['status', 'Status'],
  ['domain', 'Email domain'],
  ['slack', 'On Slack'],
  ['tpl', 'Template…']
]
const LINES: [LineKind, string][] = [
  ['best', 'Local › Slack › Hack Club name'],
  ['local', 'Local name'],
  ['hca', 'Hack Club name'],
  ['sfull', 'Slack full name'],
  ['sdisplay', 'Slack display name'],
  ['email', 'Email'],
  ['tpl', 'Template…']
]

function Select<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

function TemplateRow({ id, label, value, onChange }: { id: string; label: string; value: string; onChange(v: string): void }) {
  const [result] = useTemplates([{ tpl: value, ctx: emptyContext() }]) ?? []
  const error = result && !result.ok ? result.error : null
  return (
    <div className="view-tpl">
      <TemplateInput id={id} ariaLabel={label} value={value} onChange={onChange} invalid={!!error} />
      {error && <p className="error-text small">{error}</p>}
    </div>
  )
}

export function ViewOptions({ view, onChange, children }: { view: ViewSettings; onChange(v: ViewSettings): void; children: ReactNode }) {
  const set = (patch: Partial<ViewSettings>) => onChange({ ...view, ...patch })
  const anyTpl = view.groupBy === 'tpl' || view.line1 === 'tpl' || view.line2 === 'tpl'
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover view-options" side="bottom" align="start" sideOffset={6} collisionPadding={12}>
          <div className="view-row">
            <label htmlFor="view-sort">Sort by</label>
            <div className="view-pair">
              <Select
                id="view-sort"
                value={view.sortBy}
                options={SORTS}
                onChange={(v) => set({ sortBy: v, sortDir: v === 'added' ? 'desc' : 'asc' })}
              />
              {view.sortBy !== 'manual' && (
                <button className="btn btn-small" onClick={() => set({ sortDir: view.sortDir === 'desc' ? 'asc' : 'desc' })}>
                  {sortDirLabel(view)}
                </button>
              )}
            </div>
          </div>
          <div className="view-row">
            <label htmlFor="view-group">Group by</label>
            <Select id="view-group" value={view.groupBy} options={GROUPS} onChange={(v) => set({ groupBy: v })} />
            {view.groupBy === 'tpl' && <TemplateRow id="view-group-tpl" label="Group template" value={view.groupTpl} onChange={(v) => set({ groupTpl: v })} />}
          </div>
          <div className="view-row">
            <label htmlFor="view-line1">First line</label>
            <Select id="view-line1" value={view.line1} options={LINES as [ViewSettings['line1'], string][]} onChange={(v) => set({ line1: v })} />
            {view.line1 === 'tpl' && <TemplateRow id="view-line1-tpl" label="First line template" value={view.line1Tpl} onChange={(v) => set({ line1Tpl: v })} />}
          </div>
          <div className="view-row">
            <label htmlFor="view-line2">Second line</label>
            <Select id="view-line2" value={view.line2} options={[...LINES, ['none', 'Nothing']]} onChange={(v) => set({ line2: v })} />
            {view.line2 === 'tpl' && <TemplateRow id="view-line2-tpl" label="Second line template" value={view.line2Tpl} onChange={(v) => set({ line2Tpl: v })} />}
          </div>
          <div className="view-foot">
            {anyTpl ? (
              <button className="btn-link strong inline" onClick={() => void window.ham.openExternal('https://jinja.palletsprojects.com/en/stable/templates/')}>
                Jinja syntax
              </button>
            ) : (
              <span />
            )}
            <Popover.Close className="btn btn-small">Done</Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
