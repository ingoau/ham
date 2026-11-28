import { TAG_COLORS, type Account, type AccountGroup, type AccountTag, type AppState } from '@shared/types'
import { displayName } from '../util'
import { AddAccountsDialog, type AddMode } from './AddAccountsDialog'
import { GroupNameDialog } from './GroupNameDialog'
import { SettingsDialog } from './SettingsDialog'
import { SlackTokensDialog } from './SlackTokensDialog'
import { TagDialog } from './TagDialog'

/** The one sheet (dialog) open at a time, if any. */
export type Sheet =
  | null
  | { kind: 'add'; mode: AddMode }
  | { kind: 'settings' }
  | { kind: 'new-group'; ids: string[] }
  | { kind: 'rename-group'; group: AccountGroup }
  | { kind: 'local-name'; account: Account }
  | { kind: 'slack-tokens'; account: Account }
  | { kind: 'tag'; tag: AccountTag | null; ids: string[]; fromFilter?: boolean }

interface Props {
  /** From useLatched(sheet): the sheet keeps its content while it animates closed. */
  latch: { value: Sheet; open: boolean; n: number }
  app: AppState
  inboxOn: boolean
  onSheet(sheet: Sheet): void
  onAddEmails(emails: string[]): void
  onCreateGroup(name: string, ids: string[]): void
  onSaveTag(tag: AccountTag | null, ids: string[], name: string, color: AccountTag['color']): void
}

export function AppSheets({ latch, app, inboxOn, onSheet, onAddEmails, onCreateGroup, onSaveTag }: Props) {
  const sheet = latch.value
  const close = () => onSheet(null)
  if (!sheet) return null
  switch (sheet.kind) {
    case 'add':
      return (
        <AddAccountsDialog
          key={latch.n}
          open={latch.open}
          mode={sheet.mode}
          accounts={app.accounts}
          inboxOn={inboxOn}
          onMode={(mode) => onSheet({ kind: 'add', mode })}
          onClose={close}
          onAdd={onAddEmails}
          onOpenSettings={() => onSheet({ kind: 'settings' })}
        />
      )
    case 'settings':
      return <SettingsDialog key={latch.n} open={latch.open} app={app} onClose={close} />
    case 'new-group':
      return (
        <GroupNameDialog
          key={latch.n}
          open={latch.open}
          initial=""
          count={sheet.ids.length}
          onClose={close}
          onSubmit={(name) => onCreateGroup(name, sheet.ids)}
        />
      )
    case 'rename-group':
      return (
        <GroupNameDialog
          key={latch.n}
          open={latch.open}
          initial={sheet.group.name}
          count={0}
          onClose={close}
          onSubmit={(name) => {
            close()
            void window.ham.groups.rename(sheet.group.id, name)
          }}
        />
      )
    case 'local-name':
      return (
        <GroupNameDialog
          key={latch.n}
          open={latch.open}
          title="Local name"
          initial={sheet.account.localName}
          placeholder={displayName(sheet.account)}
          submitLabel="Save"
          allowEmpty
          count={0}
          onClose={close}
          onSubmit={(name) => {
            close()
            void window.ham.accounts.setLocalName(sheet.account.id, name)
          }}
        />
      )
    case 'slack-tokens':
      return <SlackTokensDialog key={latch.n} open={latch.open} account={sheet.account} onClose={close} />
    case 'tag':
      return (
        <TagDialog
          key={latch.n}
          open={latch.open}
          tag={sheet.tag}
          count={sheet.ids.length}
          nextColor={TAG_COLORS[app.tags.length % TAG_COLORS.length]}
          onClose={close}
          onSubmit={(name, color) => onSaveTag(sheet.tag, sheet.ids, name, color)}
          returnFocus={sheet.fromFilter ? () => document.querySelector<HTMLElement>('[data-filter-button]')?.focus() : undefined}
        />
      )
  }
}
