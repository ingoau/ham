import { Command } from 'cmdk'
import { ClipboardList, FolderPlus, Inbox, ListChecks, ListFilter, Mail, Plus, Settings, Tag } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Account, AccountTag } from '@shared/types'
import { displayName } from '../util'
import { Avatar } from './Avatar'

export type PaletteAction = 'add' | 'paste' | 'inbox' | 'settings' | 'link-inbox' | 'select-all' | 'new-group' | 'new-tag' | 'filter'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  accounts: Account[]
  tags: AccountTag[]
  selectedId: string | null
  mod: string
  onSelectAccount(id: string): void
  onAction(action: PaletteAction): void
}

const ACTIONS: { id: PaletteAction; label: string; icon: ReactNode; keywords: string[]; shortcut?: string }[] = [
  { id: 'add', label: 'Add accounts', icon: <Plus size={16} />, keywords: ['new', 'sign in', 'add account'], shortcut: 'N' },
  { id: 'paste', label: 'Paste a list of emails', icon: <ClipboardList size={16} />, keywords: ['import', 'bulk', 'add'] },
  { id: 'inbox', label: 'Find accounts in my inbox', icon: <Mail size={16} />, keywords: ['import', 'imap', 'search', 'add'] },
  { id: 'settings', label: 'Open Settings', icon: <Settings size={16} />, keywords: ['preferences', 'theme', 'dark', 'light'], shortcut: ',' },
  { id: 'link-inbox', label: 'Link inbox', icon: <Inbox size={16} />, keywords: ['imap', 'email', 'autofill', 'codes'] },
  { id: 'select-all', label: 'Select all accounts', icon: <ListChecks size={16} />, keywords: ['bulk', 'edit', 'selection'], shortcut: 'A' },
  { id: 'new-group', label: 'New group', icon: <FolderPlus size={16} />, keywords: ['folder', 'organise', 'organize', 'section'], shortcut: '⇧N' },
  { id: 'new-tag', label: 'New tag', icon: <Tag size={16} />, keywords: ['label', 'organise', 'organize'], shortcut: '⇧T' },
  { id: 'filter', label: 'Filter accounts', icon: <ListFilter size={16} />, keywords: ['tags', 'status', 'show', 'hide'], shortcut: '⇧L' }
]

/** ⌘K: jump to any account or run an action. Filtering and keyboard handling come from cmdk. */
export function CommandPalette({ open, onOpenChange, accounts, tags, selectedId, mod, onSelectAccount, onAction }: Props) {
  const run = (fn: () => void) => () => {
    onOpenChange(false)
    fn()
  }
  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="Search accounts and actions" overlayClassName="overlay instant" contentClassName="cmdk-dialog" loop>
      <Command.Input className="cmdk-input" placeholder="Search accounts and actions…" />
      <Command.List className="cmdk-list">
        <Command.Empty className="cmdk-empty">No matches.</Command.Empty>
        {accounts.length > 0 && (
          <Command.Group heading="Accounts" className="cmdk-group">
            {accounts.map((a) => (
              <Command.Item
                key={a.id}
                className="cmdk-item"
                value={`account ${a.id}`}
                keywords={[
                  a.localName,
                  displayName(a),
                  a.email,
                  a.slack.profile.display_name ?? '',
                  a.slack.profile.real_name ?? '',
                  ...tags.filter((t) => a.tagIds.includes(t.id)).map((t) => t.name)
                ].filter(Boolean)}
                onSelect={run(() => onSelectAccount(a.id))}
              >
                <Avatar account={a} size={26} />
                <span className="cmdk-label">
                  <span className="cmdk-name">{a.fresh ? a.email : displayName(a)}</span>
                  <span className="cmdk-sub">{a.fresh ? 'Adding' : a.email}</span>
                </span>
                {a.status === 'signed-out' && <span className="badge tone-warn">Signed out</span>}
                {a.id === selectedId && <span className="cmdk-current">Current</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="Actions" className="cmdk-group">
          {ACTIONS.map((x) => (
            <Command.Item key={x.id} className="cmdk-item" value={`action ${x.label}`} keywords={x.keywords} onSelect={run(() => onAction(x.id))}>
              <span className="cmdk-icon" aria-hidden>
                {x.icon}
              </span>
              <span className="cmdk-label">{x.label}</span>
              {x.shortcut && <kbd className="cmdk-kbd">{`${mod}${x.shortcut}`}</kbd>}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}

