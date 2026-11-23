import { useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { Check, ChevronDown, Folder, LogIn, Pin, PinOff, Tag, X } from 'lucide-react'
import { ALL_FIELDS, FIELD_GROUPS, HCA_FIELDS, fieldEditable, type FieldDef } from '@shared/fields'
import type { Account, AccountTag } from '@shared/types'
import { bulkJobs, planBulk, type BulkPlan } from '../bulk'
import { useTemplates } from '../templates'
import { displayName } from '../util'
import { Avatar } from './Avatar'
import { TemplateInput } from './TemplateInput'

interface Props {
  picked: Account[]
  busy: boolean
  onClear(): void
  onPin(pinned: boolean): void
  /** Opens the Move to Group menu. */
  onGroup(): void
  tags: AccountTag[]
  /** Opens the tag checklist. */
  onTags(): void
  onSignInAgain(): void
  onApply(field: FieldDef, plan: BulkPlan): void
}

function FieldPicker({ field, onPick }: { field: FieldDef; onPick(f: FieldDef): void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button id="bulk-field" className="select field-trigger" aria-haspopup="listbox">
          <span className="field-trigger-text">
            <span>{field.name}</span>
            <span className="muted small">{field.group}</span>
          </span>
          <ChevronDown size={15} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover field-menu" align="start" sideOffset={4} collisionPadding={12}>
          <Command label="Fields" loop>
            <Command.Input className="cmdk-input small" placeholder="Search fields" autoFocus />
            <Command.List className="cmdk-list">
              <Command.Empty className="cmdk-empty">No fields match</Command.Empty>
              {FIELD_GROUPS.map((g) => (
                <Command.Group key={g} heading={g} className="cmdk-group">
                  {ALL_FIELDS.filter((f) => f.group === g).map((f) => {
                    const editable = fieldEditable(f)
                    return (
                      <Command.Item
                        key={f.id}
                        className="cmdk-item compact"
                        value={`${f.group} ${f.name}`}
                        disabled={!editable}
                        onSelect={() => {
                          onPick(f)
                          setOpen(false)
                        }}
                      >
                        <span className="cmdk-label">{f.name}</span>
                        {!editable && <span className="muted small">{f.locked ? 'Admin only' : 'Needs Slack'}</span>}
                        {f.id === field.id && <Check size={14} aria-hidden />}
                      </Command.Item>
                    )
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** The right pane while accounts are selected: who's selected, quick actions, and bulk edit. */
export function BulkPanel({ picked, busy, onClear, onPin, onGroup, onTags, onSignInAgain, onApply }: Props) {
  const [field, setField] = useState<FieldDef>(HCA_FIELDS[0])
  const [tpl, setTpl] = useState('{{ current }}')
  const { targets, jobs } = useMemo(() => bulkJobs(picked, field, tpl), [picked, field, tpl])
  const results = useTemplates(jobs)
  const fresh = results && results.length === jobs.length ? results : null
  const plan = planBulk(picked, field, targets, fresh)
  const count = plan.changes.length
  const disabled = busy || !fresh || !!plan.templateError || plan.invalid > 0 || count === 0
  const label = busy ? 'Another update is running' : count ? `Apply to ${count} ${count === 1 ? 'account' : 'accounts'}` : 'No changes'
  const allPinned = picked.every((a) => a.pinned)
  const signedOut = picked.filter((a) => a.status === 'signed-out').length

  return (
    <div className="bulk-panel">
      <header className="detail-header">
        <div className="avatar-stack" aria-hidden>
          {picked.slice(0, 4).map((a) => (
            <Avatar key={a.id} account={a} size={44} />
          ))}
        </div>
        <div className="who">
          <h1>
            {picked.length} {picked.length === 1 ? 'account' : 'accounts'} selected
          </h1>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => onPin(!allPinned)}>
            {allPinned ? <PinOff size={15} aria-hidden /> : <Pin size={15} aria-hidden />}
            {allPinned ? 'Unpin' : 'Pin'}
          </button>
          <button className="btn" onClick={onGroup} aria-haspopup="menu">
            <Folder size={15} aria-hidden />
            Group
          </button>
          <button className="btn" onClick={onTags} aria-haspopup="menu">
            <Tag size={15} aria-hidden />
            Tags
          </button>
          {signedOut > 0 && (
            <button className="btn" onClick={onSignInAgain}>
              <LogIn size={15} aria-hidden />
              Sign in again
            </button>
          )}
          <button className="btn" onClick={onClear}>
            <X size={15} aria-hidden />
            Clear
          </button>
        </div>
      </header>

      <section className="card" aria-labelledby="bulk-heading">
        <h2 id="bulk-heading">Bulk edit</h2>
        <div className="field">
          <label htmlFor="bulk-field">Field</label>
          <FieldPicker field={field} onPick={setField} />
        </div>

        <div className="field">
          <div className="label-row">
            <label htmlFor="bulk-tpl">Template</label>
            <button className="btn-link strong inline" onClick={() => void window.ham.openExternal('https://jinja.palletsprojects.com/en/stable/templates/')}>
              Jinja syntax
            </button>
          </div>
          <TemplateInput id="bulk-tpl" ariaLabel="Template" value={tpl} onChange={setTpl} invalid={!!plan.templateError} />
          {plan.templateError ? (
            <p className="error-text small" role="alert">
              {plan.templateError}
            </p>
          ) : (
            <span className="hint mono">index · total · current · account.*</span>
          )}
        </div>

        <div className="preview" role="region" aria-label="Preview">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Now</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((r) => (
                <tr key={r.account.id}>
                  <td title={r.account.email}>{r.account.fresh ? r.account.email : displayName(r.account)}</td>
                  <td className="muted">{r.now || '—'}</td>
                  <td className={`after after-${r.kind}`}>{r.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-actions">
          {plan.invalid > 0 && (
            <span className="error-text small">{plan.invalid === 1 ? '1 value isn’t valid' : `${plan.invalid} values aren’t valid`}</span>
          )}
          <button className="btn btn-primary" disabled={disabled} onClick={() => onApply(field, plan)}>
            {label}
          </button>
        </div>
      </section>
    </div>
  )
}
