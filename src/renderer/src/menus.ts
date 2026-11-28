// Native context menus for accounts, sections and tags: the items only. App
// shows them (window.ham.ui.contextMenu) and acts on the chosen id.
import { isPending, type Account, type AccountGroup, type AccountTag, type ContextMenuItem } from '@shared/types'
import type { GroupModel } from './view'

/** Accounts a Slack sign-in would do something for: signed in to Hack Club, not to Slack. */
export const slackTargets = (list: Account[]) => list.filter((a) => a.status === 'signed-in' && !a.slack.session)

/** Whether the account is on Hack Club Slack, so a sign-in won't create a Slack account. */
export const onSlack = (account: Account) => account.slack.linked === true || account.slack.session

/** The "Move to Group" items shared by account menus and the bulk pane. Ids: `group:<id>`, `group:new`, `group:none`. */
export const groupItems = (groups: AccountGroup[], list: Account[]): ContextMenuItem[] => [
  ...groups.map((g) => ({ id: `group:${g.id}`, label: g.name, checked: list.every((a) => a.groupId === g.id) })),
  ...(groups.length ? [{ type: 'separator' as const }] : []),
  { id: 'group:new', label: 'New Group…' },
  ...(list.some((a) => a.groupId) ? [{ id: 'group:none', label: 'Remove from Group' }] : [])
]

/** The tag checklist shared by account menus, the bulk pane and the detail header. Ids: `tag:<id>`, `tag:new`. */
export const tagItems = (tags: AccountTag[], list: Account[]): ContextMenuItem[] => [
  ...tags.map((t) => ({ id: `tag:${t.id}`, label: t.name, checked: list.length > 0 && list.every((a) => a.tagIds.includes(t.id)) })),
  ...(tags.length ? [{ type: 'separator' as const }] : []),
  { id: 'tag:new', label: 'New Tag…' }
]

/** The rest of a prefixed choice (`group:abc` → `abc`), or null for another kind of choice. */
export const choiceFor = (choice: string | null, prefix: 'group' | 'tag'): string | null =>
  choice?.startsWith(`${prefix}:`) ? choice.slice(prefix.length + 1) : null

interface AccountMenuOptions {
  account: Account
  /** The accounts the menu acts on: the selection when the account is in one, else just the account. */
  list: Account[]
  /** The account is one of several selected. */
  many: boolean
  picked: Set<string>
  groups: AccountGroup[]
  tags: AccountTag[]
  /** Manual sort, so Move Up/Down apply. */
  draggable: boolean
}

/** Right-click on an account row. */
export function accountMenu({ account, list, many, picked, groups, tags, draggable }: AccountMenuOptions): ContextMenuItem[] {
  const signedIn = account.status === 'signed-in'
  const pinLabel = list.every((a) => a.pinned) ? (many ? `Unpin ${list.length} Accounts` : 'Unpin') : many ? `Pin ${list.length} Accounts` : 'Pin'
  if (many) {
    return [
      { id: 'pin', label: pinLabel, accelerator: 'CmdOrCtrl+Shift+P' },
      { label: 'Move to Group', submenu: groupItems(groups, list) },
      { label: 'Tags', submenu: tagItems(tags, list) },
      ...(list.some((a) => a.status === 'signed-out') ? [{ id: 'sign-in', label: 'Sign In Again' }] : []),
      ...(slackTargets(list).length ? [{ id: 'slack-sign-in', label: 'Sign In to Slack' }] : []),
      { id: 'copy', label: `Copy ${list.length} Emails` },
      { type: 'separator' },
      { id: 'deselect', label: 'Deselect All', accelerator: 'CmdOrCtrl+Shift+A' },
      { type: 'separator' },
      { id: 'remove', label: `${list.some((a) => a.status === 'signed-in') ? 'Sign Out and Remove' : 'Remove'} ${list.length} Accounts…` }
    ]
  }
  return [
    { id: 'open', label: 'Open' },
    ...(signedIn
      ? [
          { id: 'dashboard', label: 'Open Hack Club Auth' },
          { id: 'slack', label: 'Launch Slack' },
          ...(onSlack(account) ? [{ id: 'slack-tokens', label: 'Get Slack Tokens…' }] : []),
          { id: 'refresh', label: 'Refresh' }
        ]
      : []),
    ...(account.slack.session ? [{ id: 'slack-sign-out', label: 'Sign Out of Slack' }] : []),
    ...(account.status === 'signed-out' ? [{ id: 'sign-in', label: 'Sign In Again' }] : []),
    { type: 'separator' },
    { id: 'pin', label: pinLabel, accelerator: 'CmdOrCtrl+Shift+P' },
    { label: 'Move to Group', submenu: groupItems(groups, list) },
    { label: 'Tags', submenu: tagItems(tags, list) },
    ...(draggable
      ? [
          { id: 'up', label: 'Move Up', accelerator: 'Alt+CmdOrCtrl+Up' },
          { id: 'down', label: 'Move Down', accelerator: 'Alt+CmdOrCtrl+Down' }
        ]
      : []),
    { id: 'select', label: picked.has(account.id) ? 'Deselect' : 'Select' },
    { type: 'separator' },
    { id: 'local-name', label: account.localName ? 'Edit Local Name…' : 'Set Local Name…' },
    { id: 'copy', label: 'Copy Email' },
    { type: 'separator' },
    {
      id: 'remove',
      label: isPending(account.status) ? (account.fresh ? 'Cancel and Remove' : 'Cancel Sign-in') : signedIn ? 'Sign Out and Remove…' : 'Remove…'
    }
  ]
}

/** Right-click on a section header. `own`: the user's group the section shows, if any. */
export function sectionMenu(section: GroupModel, groups: AccountGroup[], own: AccountGroup | undefined): ContextMenuItem[] {
  const members = section.rows.map((r) => r.account)
  const at = own ? groups.indexOf(own) : -1
  return [
    { id: 'toggle', label: section.open ? 'Collapse' : 'Expand' },
    { id: 'select', label: 'Select Accounts in Group', enabled: members.length > 0 },
    ...(slackTargets(members).length ? [{ id: 'slack-sign-in', label: 'Sign In to Slack' }] : []),
    ...(own
      ? [
          { type: 'separator' as const },
          { id: 'rename', label: 'Rename…' },
          { id: 'up', label: 'Move Up', enabled: at > 0 },
          { id: 'down', label: 'Move Down', enabled: at < groups.length - 1 },
          { type: 'separator' as const },
          { id: 'delete', label: 'Delete Group' }
        ]
      : []),
    { type: 'separator' },
    { id: 'new', label: 'New Group…' }
  ]
}

/** Edit or delete a tag (from the filter popover). `selectable`: some of its accounts are on screen. */
export function tagMenu(tag: AccountTag, tags: AccountTag[], selectable: boolean): ContextMenuItem[] {
  const at = tags.indexOf(tag)
  return [
    { id: 'edit', label: 'Edit…' },
    { id: 'select', label: 'Select Accounts with Tag', enabled: selectable },
    { id: 'up', label: 'Move Up', enabled: at > 0 },
    { id: 'down', label: 'Move Down', enabled: at < tags.length - 1 },
    { type: 'separator' },
    { id: 'delete', label: 'Delete Tag' }
  ]
}

/** Click on a tag chip in the detail header. */
export const chipMenu = (tag: AccountTag): ContextMenuItem[] => [
  { id: 'remove', label: `Remove “${tag.name}”` },
  { id: 'filter', label: `Show Only “${tag.name}”` },
  { type: 'separator' },
  { id: 'edit', label: 'Edit Tag…' }
]

/** Swap two neighbours in a list of ids (for Move Up / Move Down). */
export function swapped(ids: string[], at: number, direction: 'up' | 'down'): string[] {
  const next = [...ids]
  const j = direction === 'up' ? at - 1 : at + 1
  if (at < 0 || j < 0 || j >= next.length) return next
  ;[next[at], next[j]] = [next[j], next[at]]
  return next
}
