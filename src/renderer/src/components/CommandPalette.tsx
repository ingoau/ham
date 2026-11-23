import { Command } from 'cmdk'
import { ExternalLink, LogIn, LogOut, PanelsTopLeft, Plus, RotateCw, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Account } from '@shared/types'
import { displayName } from '../util'
import { Avatar } from './Avatar'

export type PaletteAction = 'add' | 'refresh' | 'toggle-tab' | 'pop-out' | 'sign-out' | 'sign-in-again'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  accounts: Account[]
  selected: Account | null
  tab: 'profile' | 'web'
  mod: string
  onSelectAccount(id: string): void
  onAction(action: PaletteAction): void
}

function Item({
  value,
  keywords,
  icon,
  label,
  shortcut,
  onSelect
}: {
  value: string
  keywords?: string[]
  icon: ReactNode
  label: string
  shortcut?: string
  onSelect(): void
}) {
  return (
    <Command.Item className="cmdk-item" value={value} keywords={keywords} onSelect={onSelect}>
      <span className="cmdk-icon">{icon}</span>
      <span className="cmdk-label">{label}</span>
      {shortcut && <kbd className="cmdk-kbd">{shortcut}</kbd>}
    </Command.Item>
  )
}

/** ⌘K: jump to any account or run an action. Filtering and keyboard handling come from cmdk. */
export function CommandPalette({ open, onOpenChange, accounts, selected, tab, mod, onSelectAccount, onAction }: Props) {
  const run = (fn: () => void) => () => {
    onOpenChange(false)
    fn()
  }
  const signedIn = selected?.status === 'signed-in'

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="overlay"
      contentClassName="cmdk-dialog"
      loop
    >
      <Command.Input className="cmdk-input" placeholder="Search accounts and actions…" />
      <Command.List className="cmdk-list">
        <Command.Empty className="cmdk-empty">No matches.</Command.Empty>

        {accounts.length > 0 && (
          <Command.Group heading="Accounts" className="cmdk-group">
            {accounts.map((a, i) => (
              <Command.Item
                key={a.id}
                className="cmdk-item"
                value={`account ${a.id}`}
                keywords={[a.firstName, a.lastName, a.email, displayName(a)]}
                onSelect={run(() => onSelectAccount(a.id))}
              >
                <Avatar account={a} size={26} />
                <span className="cmdk-label">
                  <span className="cmdk-name">{displayName(a)}</span>
                  <span className="cmdk-sub">{a.email}</span>
                </span>
                {a.status === 'signed-out' && <span className="pill-warn">Signed out</span>}
                {a.id === selected?.id && <span className="cmdk-current">Current</span>}
                {i < 9 && <kbd className="cmdk-kbd">{`${mod}${i + 1}`}</kbd>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Actions" className="cmdk-group">
          <Item value="add account" keywords={['new', 'sign in']} icon={<Plus size={16} />} label="Add account" shortcut={`${mod}N`} onSelect={run(() => onAction('add'))} />
          {selected && signedIn && (
            <>
              <Item
                value="refresh account"
                keywords={['reload', 'sync']}
                icon={<RotateCw size={15} />}
                label={`Refresh ${displayName(selected)}`}
                shortcut={`${mod}R`}
                onSelect={run(() => onAction('refresh'))}
              />
              <Item
                value="switch tab"
                keywords={['dashboard', 'hack club auth', 'profile', 'web']}
                icon={tab === 'web' ? <UserRound size={16} /> : <PanelsTopLeft size={16} />}
                label={tab === 'web' ? 'Show profile' : 'Open Hack Club Auth dashboard'}
                shortcut={`${mod}⇧D`}
                onSelect={run(() => onAction('toggle-tab'))}
              />
              <Item
                value="pop out dashboard"
                keywords={['window', 'browser', 'hack club auth']}
                icon={<ExternalLink size={15} />}
                label="Open Hack Club Auth in a new window"
                onSelect={run(() => onAction('pop-out'))}
              />
            </>
          )}
          {selected && !signedIn && (
            <Item value="sign in again" keywords={['login', 'expired']} icon={<LogIn size={16} />} label={`Sign in to ${selected.email} again`} onSelect={run(() => onAction('sign-in-again'))} />
          )}
          {selected && (
            <Item
              value="sign out remove"
              keywords={['logout', 'delete']}
              icon={<LogOut size={15} />}
              label={signedIn ? `Sign out of ${selected.email}` : `Remove ${selected.email}`}
              onSelect={run(() => onAction('sign-out'))}
            />
          )}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
