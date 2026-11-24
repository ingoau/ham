import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { Lock, MessageSquare, Plus, RotateCw, Tag, UserPlus } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { fieldValue, type FieldDef } from '@shared/fields'
import {
  isPending,
  TAG_COLORS,
  type Account,
  type AccountFilter,
  type AccountGroup,
  type AccountTag,
  type AppState,
  type ContextMenuItem,
  type DashboardNotice,
  type DashboardState,
  type MenuCommand,
  type SaveResult,
  type ViewSettings
} from '@shared/types'
import { contextFor, type BulkPlan } from './bulk'
import { useTemplates } from './templates'
import { displayName, formatDate } from './util'
import { buildView, type GroupModel, type TemplateValues } from './view'
import { AddAccountsDialog, type AddMode } from './components/AddAccountsDialog'
import { Avatar } from './components/Avatar'
import { BulkPanel } from './components/BulkPanel'
import { GroupNameDialog } from './components/GroupNameDialog'
import { LocalNameCard } from './components/LocalNameCard'
import { useLatched } from './latch'
import { CommandPalette, type PaletteAction } from './components/CommandPalette'
import { DashboardPane } from './components/DashboardPane'
import { PendingPane } from './components/PendingPane'
import { ProfileForm, type ProfileFormHandle } from './components/ProfileForm'
import { SessionCard } from './components/SessionCard'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar, type BulkProgress, type SectionMove } from './components/Sidebar'
import { SignOutDialog } from './components/SignOutDialog'
import { TagDialog } from './components/TagDialog'
import { TagDot } from './components/Tags'

type Tab = 'profile' | 'web'
type Sheet =
  | null
  | { kind: 'add'; mode: AddMode }
  | { kind: 'settings' }
  | { kind: 'new-group'; ids: string[] }
  | { kind: 'rename-group'; group: AccountGroup }
  | { kind: 'local-name'; account: Account }
  | { kind: 'tag'; tag: AccountTag | null; ids: string[]; fromFilter?: boolean }

const remembered = {
  get: (key: string) => {
    try {
      return localStorage.getItem(`ham.${key}`)
    } catch {
      return null
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value === null) localStorage.removeItem(`ham.${key}`)
      else localStorage.setItem(`ham.${key}`, value)
    } catch {
      // storage unavailable: not worth failing over
    }
  }
}

/** Render the list's template lines and template groups, by account id. */
function useViewTemplates(accounts: Account[], view: ViewSettings | undefined): TemplateValues {
  const plan = useMemo(() => {
    const kinds: (keyof TemplateValues)[] = []
    const tpls: string[] = []
    if (view?.line1 === 'tpl') kinds.push('line1'), tpls.push(view.line1Tpl)
    if (view?.line2 === 'tpl') kinds.push('line2'), tpls.push(view.line2Tpl)
    if (view?.groupBy === 'tpl') kinds.push('group'), tpls.push(view.groupTpl)
    const jobs = kinds.flatMap((_, k) => accounts.map((a, i) => ({ tpl: tpls[k], ctx: contextFor(a, i + 1, accounts.length, '') })))
    return { kinds, jobs }
  }, [accounts, view])
  const results = useTemplates(plan.jobs)
  return useMemo(() => {
    const tv: TemplateValues = { line1: new Map(), line2: new Map(), group: new Map() }
    if (!results || results.length !== plan.jobs.length) return tv
    plan.kinds.forEach((kind, k) =>
      accounts.forEach((a, i) => {
        const r = results[k * accounts.length + i]
        tv[kind].set(a.id, r.ok ? r.value : kind === 'group' ? '(template error)' : displayName(a))
      })
    )
    return tv
  }, [results, plan, accounts])
}

export function App() {
  const [app, setApp] = useState<AppState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() => remembered.get('selected'))
  const [tab, setTab] = useState<Tab>('profile')
  const [sheet, setSheet] = useState<Sheet>(null)
  const [confirmSignOut, setConfirmSignOut] = useState<Account[] | null>(null)
  const [slackConfirm, setSlackConfirm] = useState<Account | null>(null)
  // Dialogs keep their content while they animate closed.
  const sheetLatch = useLatched(sheet)
  const signOutLatch = useLatched(confirmSignOut)
  const slackLatch = useLatched(slackConfirm)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dashState, setDashState] = useState<DashboardState | null>(null)
  const [notice, setNotice] = useState<DashboardNotice | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [progress, setProgress] = useState<BulkProgress | null>(null)
  const [now, setNow] = useState(Date.now())
  const formRef = useRef<ProfileFormHandle>(null)
  const cancelBulk = useRef(false)
  // Only one background job (bulk edit, undo or bulk sign-out) at a time; they share the progress card.
  const bulkRunning = useRef(false)
  const menuRef = useRef<(c: MenuCommand) => void>(() => {})

  useEffect(() => {
    void window.ham.getState().then((s) => {
      setApp(s)
      document.documentElement.classList.add(`platform-${s.info.platform}`)
    })
    return window.ham.onEvent((event) => {
      if (event.type === 'state') setApp(event.state)
      else if (event.type === 'dashboard-state') setDashState(event.state)
      else if (event.type === 'dashboard-notice') setNotice(event.notice)
      else if (event.type === 'menu') menuRef.current(event.command)
      else if (event.type === 'toast') {
        if (event.kind === 'success') toast.success(event.text)
        else if (event.kind === 'error') toast.error(event.text)
        else toast(event.text)
      }
    })
  }, [])

  const accounts = app?.accounts ?? []
  const inboxOn = app?.inbox.state === 'connected'
  const anyPending = accounts.some((a) => isPending(a.status))

  // Countdowns tick while anything is being added.
  useEffect(() => {
    if (!anyPending) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyPending])

  const tv = useViewTemplates(accounts, app?.view)
  const viewModel = useMemo(
    () =>
      app
        ? buildView(accounts, app.view, tv, inboxOn, now, app.groups, new Set(app.tags.map((t) => t.id)))
        : { groups: [], order: [], visible: [], total: 0, filtering: false, showSub: true, draggable: false },
    [app, accounts, tv, inboxOn, now]
  )

  const selected = accounts.find((a) => a.id === selectedId) ?? accounts.find((a) => a.id === viewModel.order[0]) ?? accounts[0] ?? null
  useEffect(() => {
    remembered.set('selected', selected?.id ?? null)
  }, [selected?.id])

  // Drop picked ids that no longer exist or that the filter hides (bulk actions shouldn't reach unseen accounts).
  useEffect(() => {
    const shown = new Set(viewModel.visible)
    if ([...picked].some((id) => !shown.has(id))) setPicked(new Set([...picked].filter((id) => shown.has(id))))
  }, [viewModel.visible, picked])

  const select = (id: string) => {
    setSelectedId(id)
    setNotice(null)
    setTab('profile')
    // Like Finder: a plain click on a row replaces the selection.
    setPicked(new Set())
    setAnchor(id)
  }

  /** Shift+arrow: select the range from the anchor to this account. */
  const extendTo = (id: string) => {
    const order = viewModel.order
    const base = anchor && order.includes(anchor) ? anchor : selected?.id ?? id
    const a = order.indexOf(base)
    const b = order.indexOf(id)
    if (a === -1 || b === -1) return
    setPicked(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)))
    setAnchor(base)
  }

  /** Accounts an action applies to: the selection, or the open account. */
  const targets = (): Account[] => (picked.size > 0 ? accounts.filter((a) => picked.has(a.id)) : selected ? [selected] : [])

  const setPinned = (list: Account[], pinned: boolean) => {
    if (list.length === 0) return
    const ids = new Set(list.map((a) => a.id))
    setApp((s) => (s ? { ...s, accounts: s.accounts.map((a) => (ids.has(a.id) ? { ...a, pinned } : a)) } : s))
    void window.ham.accounts.setPinned([...ids], pinned)
  }

  /** Save a new manual order (every account, top to bottom) and switch to manual sort. */
  const reorder = (ids: string[], moved: SectionMove | null) => {
    setApp((s) => {
      if (!s) return s
      const byId = new Map(s.accounts.map((a) => [a.id, a]))
      const ordered = ids.map((id) => byId.get(id)).filter((a): a is Account => !!a)
      const rest = s.accounts.filter((a) => !ids.includes(a.id))
      const list = [...ordered, ...rest].map((a) =>
        moved?.id !== a.id ? a : moved.pinned ? { ...a, pinned: true } : { ...a, pinned: false, groupId: moved.groupId }
      )
      const view = s.view.sortBy === 'manual' ? s.view : { ...s.view, sortBy: 'manual' as const, sortDir: 'asc' as const }
      return { ...s, accounts: list, view }
    })
    if (moved?.pinned) void window.ham.accounts.setPinned([moved.id], true)
    else if (moved) void window.ham.accounts.setGroup([moved.id], moved.groupId)
    void window.ham.accounts.reorder(ids)
    if (app && app.view.sortBy !== 'manual') void window.ham.settings.setView({ ...app.view, sortBy: 'manual', sortDir: 'asc' })
  }

  /** Move the open account one place in its section (manual sort). */
  const move = (direction: 'up' | 'down', id = selected?.id) => {
    if (!id || !viewModel.draggable) return
    const section = viewModel.groups.find((g) => g.rows.some((r) => r.account.id === id))
    if (!section) return
    const ids = section.rows.map((r) => r.account.id)
    const i = ids.indexOf(id)
    const j = direction === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorder(
      viewModel.groups.flatMap((g) => (g === section ? ids : g.rows.map((r) => r.account.id))),
      null
    )
  }

  const groups = app?.groups ?? []

  /** Move accounts into a group (null: out of their group). Shows the group if it's collapsed or hidden. */
  const moveToGroup = (list: Account[], groupId: string | null) => {
    const ids = new Set(list.map((a) => a.id))
    setApp((s) => (s ? { ...s, accounts: s.accounts.map((a) => (ids.has(a.id) ? { ...a, groupId, pinned: false } : a)) } : s))
    void window.ham.accounts.setGroup([...ids], groupId)
    showGroups()
  }

  /** Your groups show when grouping is set to "My groups". */
  const showGroups = () => {
    if (app && app.view.groupBy !== 'none') setView({ ...app.view, groupBy: 'none' })
  }

  const createGroup = async (name: string, ids: string[]) => {
    setSheet(null)
    await window.ham.groups.create(name, ids)
    showGroups()
  }

  const deleteGroup = (group: AccountGroup) => {
    const members = accounts.filter((a) => a.groupId === group.id).map((a) => a.id)
    const at = groups.findIndex((g) => g.id === group.id)
    void window.ham.groups.remove(group.id)
    toast(`Deleted “${group.name}”`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          const id = await window.ham.groups.create(group.name, members)
          if (!id) return
          const order = groups.map((g) => g.id).filter((g) => g !== group.id)
          order.splice(at, 0, id)
          void window.ham.groups.reorder(order)
        }
      }
    })
  }

  /** The "Move to Group" items shared by account menus and the bulk pane. */
  const groupItems = (list: Account[]): ContextMenuItem[] => [
    ...groups.map((g) => ({ id: `group:${g.id}`, label: g.name, checked: list.every((a) => a.groupId === g.id) })),
    ...(groups.length ? [{ type: 'separator' as const }] : []),
    { id: 'group:new', label: 'New Group…' },
    ...(list.some((a) => a.groupId) ? [{ id: 'group:none', label: 'Remove from Group' }] : [])
  ]

  const handleGroupChoice = (choice: string | null, list: Account[]): boolean => {
    if (!choice?.startsWith('group:')) return false
    const target = choice.slice('group:'.length)
    if (target === 'new') setSheet({ kind: 'new-group', ids: list.map((a) => a.id) })
    else moveToGroup(list, target === 'none' ? null : target)
    return true
  }

  const showGroupPicker = async (list: Account[]) => {
    handleGroupChoice(await window.ham.ui.contextMenu(groupItems(list)), list)
  }

  /** Right-click on a section header. */
  const showGroupMenu = async (section: GroupModel) => {
    const members = section.rows.map((r) => r.account)
    const own = section.groupId ? groups.find((g) => g.id === section.groupId) : undefined
    const at = own ? groups.indexOf(own) : -1
    const items: ContextMenuItem[] = [
      { id: 'toggle', label: section.open ? 'Collapse' : 'Expand' },
      { id: 'select', label: 'Select Accounts in Group', enabled: members.length > 0 },
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
    const choice = await window.ham.ui.contextMenu(items)
    if (!app) return
    switch (choice) {
      case 'toggle':
        return setView({ ...app.view, collapsed: { ...app.view.collapsed, [section.key || 'accounts']: section.open } })
      case 'select':
        return setPicked(new Set(members.map((a) => a.id)))
      case 'rename':
        return own && setSheet({ kind: 'rename-group', group: own })
      case 'up':
      case 'down': {
        if (!own) return
        const ids = groups.map((g) => g.id)
        const j = choice === 'up' ? at - 1 : at + 1
        ;[ids[at], ids[j]] = [ids[j], ids[at]]
        return void window.ham.groups.reorder(ids)
      }
      case 'delete':
        return own && deleteGroup(own)
      case 'new':
        return setSheet({ kind: 'new-group', ids: [] })
    }
  }

  const tags = app?.tags ?? []
  const tagsOf = (a: Account) => tags.filter((t) => a.tagIds.includes(t.id))

  /** Add a tag to accounts (on) or take it off. */
  const setTag = (list: Account[], tagId: string, on: boolean) => {
    const ids = new Set(list.map((a) => a.id))
    setApp((s) =>
      s
        ? {
            ...s,
            accounts: s.accounts.map((a) =>
              !ids.has(a.id) || a.tagIds.includes(tagId) === on ? a : { ...a, tagIds: on ? [...a.tagIds, tagId] : a.tagIds.filter((t) => t !== tagId) }
            )
          }
        : s
    )
    void window.ham.accounts.setTag([...ids], tagId, on)
  }

  /** The tag checklist shared by account menus, the bulk pane and the detail header. */
  const tagItems = (list: Account[]): ContextMenuItem[] => [
    ...tags.map((t) => ({ id: `tag:${t.id}`, label: t.name, checked: list.length > 0 && list.every((a) => a.tagIds.includes(t.id)) })),
    ...(tags.length ? [{ type: 'separator' as const }] : []),
    { id: 'tag:new', label: 'New Tag…' }
  ]

  /** A tag ticked on every account comes off them all; otherwise it goes on every one. */
  const handleTagChoice = (choice: string | null, list: Account[]): boolean => {
    if (!choice?.startsWith('tag:')) return false
    const id = choice.slice('tag:'.length)
    if (id === 'new') setSheet({ kind: 'tag', tag: null, ids: list.map((a) => a.id) })
    else setTag(list, id, !list.every((a) => a.tagIds.includes(id)))
    return true
  }

  const showTagPicker = async (list: Account[]) => {
    handleTagChoice(await window.ham.ui.contextMenu(tagItems(list)), list)
  }

  /** Show only accounts that pass the filter (hidden ones leave the selection, see above). */
  const setFilter = (filter: AccountFilter) => {
    if (app) setView({ ...app.view, filter })
  }

  const deleteTag = (tag: AccountTag) => {
    const members = accounts.filter((a) => a.tagIds.includes(tag.id)).map((a) => a.id)
    const at = tags.findIndex((t) => t.id === tag.id)
    const wasFiltered = !!app?.view.filter.tags.includes(tag.id)
    void window.ham.tags.remove(tag.id)
    toast(`Deleted “${tag.name}”`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          const id = await window.ham.tags.create(tag.name, tag.color, members)
          if (!id) return
          const order = tags.map((t) => t.id).filter((t) => t !== tag.id)
          order.splice(at, 0, id)
          void window.ham.tags.reorder(order)
          // Deleting took it out of the filter: put it back.
          if (wasFiltered) {
            const { view } = await window.ham.getState()
            if (!view.filter.tags.includes(id)) setView({ ...view, filter: { ...view.filter, tags: [...view.filter.tags, id] } })
          }
        }
      }
    })
  }

  /** Edit or delete a tag (from the filter popover). */
  const showTagMenu = async (tag: AccountTag) => {
    const at = tags.indexOf(tag)
    const members = accounts.filter((a) => a.tagIds.includes(tag.id))
    const choice = await window.ham.ui.contextMenu([
      { id: 'edit', label: 'Edit…' },
      { id: 'select', label: 'Select Accounts with Tag', enabled: members.some((a) => viewModel.visible.includes(a.id)) },
      { id: 'up', label: 'Move Up', enabled: at > 0 },
      { id: 'down', label: 'Move Down', enabled: at < tags.length - 1 },
      { type: 'separator' },
      { id: 'delete', label: 'Delete Tag' }
    ])
    switch (choice) {
      case 'edit':
        setFilterOpen(false)
        return setSheet({ kind: 'tag', tag, ids: [], fromFilter: true })
      case 'select': {
        setFilterOpen(false)
        const shown = new Set(viewModel.visible)
        return setPicked(new Set(members.map((a) => a.id).filter((id) => shown.has(id))))
      }
      case 'up':
      case 'down': {
        const ids = tags.map((t) => t.id)
        const j = choice === 'up' ? at - 1 : at + 1
        ;[ids[at], ids[j]] = [ids[j], ids[at]]
        return void window.ham.tags.reorder(ids)
      }
      case 'delete':
        return deleteTag(tag)
    }
  }

  /** Click on a tag chip in the detail header. */
  const showChipMenu = async (account: Account, tag: AccountTag) => {
    const choice = await window.ham.ui.contextMenu([
      { id: 'remove', label: `Remove “${tag.name}”` },
      { id: 'filter', label: `Show Only “${tag.name}”` },
      { type: 'separator' },
      { id: 'edit', label: 'Edit Tag…' }
    ])
    if (choice === 'remove') setTag([account], tag.id, false)
    else if (choice === 'filter' && app) setFilter({ ...app.view.filter, tags: [tag.id] })
    else if (choice === 'edit') setSheet({ kind: 'tag', tag, ids: [] })
  }

  const saveTag = async (sheetTag: AccountTag | null, ids: string[], name: string, color: AccountTag['color']) => {
    setSheet(null)
    if (sheetTag) void window.ham.tags.update(sheetTag.id, { name, color })
    else await window.ham.tags.create(name, color, ids)
  }

  const isEditable = (el: Element | null) =>
    !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)

  const showContextMenu = async (account: Account) => {
    const many = picked.has(account.id) && picked.size > 1
    const list = many ? accounts.filter((a) => picked.has(a.id)) : [account]
    const signedIn = account.status === 'signed-in'
    const pinLabel = list.every((a) => a.pinned) ? (many ? `Unpin ${list.length} Accounts` : 'Unpin') : many ? `Pin ${list.length} Accounts` : 'Pin'
    const items: ContextMenuItem[] = many
      ? [
          { id: 'pin', label: pinLabel, accelerator: 'CmdOrCtrl+Shift+P' },
          { label: 'Move to Group', submenu: groupItems(list) },
          { label: 'Tags', submenu: tagItems(list) },
          ...(list.some((a) => a.status === 'signed-out') ? [{ id: 'sign-in', label: 'Sign In Again' }] : []),
          { id: 'copy', label: `Copy ${list.length} Emails` },
          { type: 'separator' },
          { id: 'deselect', label: 'Deselect All', accelerator: 'CmdOrCtrl+Shift+A' },
          { type: 'separator' },
          { id: 'remove', label: `${list.some((a) => a.status === 'signed-in') ? 'Sign Out and Remove' : 'Remove'} ${list.length} Accounts…` }
        ]
      : [
          { id: 'open', label: 'Open' },
          ...(signedIn
            ? [
                { id: 'dashboard', label: 'Open Hack Club Auth' },
                { id: 'slack', label: 'Launch Slack' },
                { id: 'refresh', label: 'Refresh' }
              ]
            : []),
          ...(account.status === 'signed-out' ? [{ id: 'sign-in', label: 'Sign In Again' }] : []),
          { type: 'separator' },
          { id: 'pin', label: pinLabel, accelerator: 'CmdOrCtrl+Shift+P' },
          { label: 'Move to Group', submenu: groupItems(list) },
          { label: 'Tags', submenu: tagItems(list) },
          ...(viewModel.draggable
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
    const choice = await window.ham.ui.contextMenu(items)
    if (handleGroupChoice(choice, list) || handleTagChoice(choice, list)) return
    switch (choice) {
      case 'open':
        return select(account.id)
      case 'local-name':
        return setSheet({ kind: 'local-name', account })
      case 'dashboard':
        select(account.id)
        return setTab('web')
      case 'slack':
        return launchSlack(account)
      case 'refresh':
        select(account.id)
        return void window.ham.accounts.refresh(account.id).then((r) => (r.ok ? toast.success('Profile is up to date') : toast.error('Couldn’t refresh')))
      case 'sign-in':
        return void window.ham.accounts.signInAgain(list.filter((a) => a.status === 'signed-out').map((a) => a.id))
      case 'pin':
        return setPinned(list, !list.every((a) => a.pinned))
      case 'up':
      case 'down':
        return move(choice, account.id)
      case 'select':
        return togglePick(account.id, false)
      case 'deselect':
        return setPicked(new Set())
      case 'copy':
        await window.ham.copyText(list.map((a) => a.email).join('\n'))
        return void toast.success(list.length > 1 ? `Copied ${list.length} emails` : 'Copied')
      case 'remove':
        if (many) return confirmRemove(list)
        if (isPending(account.status)) return void remove(account)
        return confirmRemove([account])
    }
  }

  const togglePick = (id: string, range: boolean) => {
    const next = new Set(picked)
    const order = viewModel.order
    const ai = anchor ? order.indexOf(anchor) : -1
    const bi = order.indexOf(id)
    if (range && ai !== -1 && bi !== -1) {
      for (let i = Math.min(ai, bi); i <= Math.max(ai, bi); i++) next.add(order[i])
    } else if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
    setAnchor(id)
  }
  /** Every account the filter shows (collapsed sections included). */
  const pickAll = () => setPicked(new Set(viewModel.visible))
  const selectAll = () => {
    if (viewModel.visible.length > 0 && viewModel.visible.every((id) => picked.has(id))) {
      setPicked(new Set())
      setAnchor(null)
    } else pickAll()
  }

  const status = selected?.status
  const pending = !!selected && isPending(selected.status)
  const signedOut = status === 'signed-out'
  const signedIn = status === 'signed-in'
  const bulkMode = picked.size > 0
  const showDashboard = tab === 'web' && signedIn && !bulkMode
  const overlayOpen = sheet !== null || confirmSignOut !== null || paletteOpen || slackConfirm !== null || filterOpen
  const mod = app?.info.platform === 'darwin' ? '⌘' : 'Ctrl+'

  const setView = useCallback((view: ViewSettings) => {
    setApp((s) => (s ? { ...s, view } : s))
    void window.ham.settings.setView(view)
  }, [])

  const refresh = async () => {
    if (!selected || refreshing) return
    setRefreshing(true)
    try {
      const r = await window.ham.accounts.refresh(selected.id)
      if (r.ok) toast.success('Profile is up to date')
      else if (r.reason === 'signed-out') toast.error('This account was signed out')
      else toast.error(r.message ?? "Couldn't reach auth.hackclub.com")
    } finally {
      setRefreshing(false)
    }
  }

  const onSaved = (result: SaveResult) => {
    if (result.ok) toast.success('Saved to auth.hackclub.com')
    else if (result.reason === 'signed-out') toast.error('Signed out. Sign in again to save.')
  }

  const addEmails = async (emails: string[]) => {
    setSheet(null)
    const { added, existing } = await window.ham.accounts.add(emails)
    if (added[0]) select(added[0])
    else if (existing[0]) {
      select(existing[0])
      toast('That account is already here')
    }
    if (added.length > 1) toast(`Adding ${added.length} accounts`)
  }

  /**
   * Sign out of (if signed in) and remove an account. For an existing account that's signing in again,
   * the first call only cancels the sign-in; `fully` makes a second call to remove it too.
   */
  const remove = async (account: Account, fully = false) => {
    let { serverSignedOut, removed } = await window.ham.accounts.remove(account.id)
    // Cancelling a sign-in is the only outcome that's not removed but "signed out".
    if (fully && !removed && serverSignedOut) ({ serverSignedOut, removed } = await window.ham.accounts.remove(account.id))
    setConfirmSignOut(null)
    if (!removed) return
    if (account.status === 'signed-in') {
      if (serverSignedOut) toast.success(`Signed out of ${account.email}`)
      else toast(`Removed ${account.email}`, { description: "HAM couldn't reach the server, so the session will expire on its own." })
    }
    if (selectedId === account.id) setSelectedId(null)
  }

  /** Take the progress card for a background job, or say why not. */
  const claimBulk = () => {
    if (bulkRunning.current) {
      toast('Wait for the current update to finish')
      return false
    }
    bulkRunning.current = true
    return true
  }

  /** Ask before signing out of (and removing) one account or a whole selection. */
  const confirmRemove = (list: Account[]) => {
    if (list.length === 0) return
    if (list.length > 1 && bulkRunning.current) return void toast('Wait for the current update to finish')
    setConfirmSignOut(list)
  }

  /** Sign out of and remove several accounts in the background, a few at a time, with a progress card. */
  const removeMany = async (list: Account[]) => {
    if (!claimBulk()) return
    const signedIn = list.filter((a) => a.status === 'signed-in').length
    const signingOut = signedIn > 0
    const label = signingOut ? 'Signing out' : 'Removing'
    const removedIds = new Set<string>()
    let unreached = 0
    let failed = 0
    let done = 0
    let next = 0
    cancelBulk.current = false
    setProgress({ label, done: 0, total: list.length })
    const worker = async () => {
      while (next < list.length && !cancelBulk.current) {
        const a = list[next++]
        try {
          let r = await window.ham.accounts.remove(a.id)
          // A sign-in in progress is only cancelled by the first call (not removed, but "signed out"); the second removes it.
          if (!r.removed && r.serverSignedOut) r = await window.ham.accounts.remove(a.id)
          if (r.removed) {
            removedIds.add(a.id)
            if (!r.serverSignedOut) unreached++
          } else failed++
        } catch {
          failed++
        }
        done++
        setProgress((p) => ({ label, done, total: list.length, cancelling: p?.cancelling }))
      }
    }
    // Sign-out isn't rate limited, but keep it gentle on the server.
    try {
      await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker))
    } finally {
      bulkRunning.current = false
      setProgress(null)
    }
    setSelectedId((id) => (id && removedIds.has(id) ? null : id))
    const n = removedIds.size
    const stopped = next < list.length ? 'Stopped. ' : ''
    const verb = signedIn === list.length ? 'Signed out of' : signingOut ? 'Signed out and removed' : 'Removed'
    const text = `${stopped}${verb} ${n} ${n === 1 ? 'account' : 'accounts'}${failed ? ` · ${failed} failed` : ''}`
    const description = unreached
      ? `HAM couldn’t reach the server for ${unreached === 1 ? 'one of them' : `${unreached} of them`}, so ${unreached === 1 ? 'that session' : 'those sessions'} will expire on their own.`
      : undefined
    ;(failed ? toast.error : unreached || stopped ? toast : toast.success)(text, { description })
  }

  const launchSlack = (account: Account) => {
    if (account.slack.linked || account.slack.session) void window.ham.accounts.launchSlack(account.id)
    else setSlackConfirm(account)
  }

  /** Save one field across accounts, one at a time, with a progress card. */
  const runBulk = async (label: string, field: FieldDef, items: { account: Account; value: string }[], undoable: boolean) => {
    if (!claimBulk()) return
    const previous: { account: Account; value: string }[] = []
    let failed = 0
    let stopped = false
    cancelBulk.current = false
    setProgress({ label, done: 0, total: items.length })
    try {
      for (let i = 0; i < items.length; i++) {
        if (cancelBulk.current) {
          stopped = true
          break
        }
        const { account, value } = items[i]
        if (field.local) {
          await window.ham.accounts.setLocalName(account.id, value)
          previous.push({ account, value: fieldValue(account, field) })
          setProgress((p) => ({ label, done: i + 1, total: items.length, cancelling: p?.cancelling }))
          continue
        }
        const latest = accounts.find((a) => a.id === account.id) ?? account
        const input = { firstName: latest.firstName, lastName: latest.lastName, phone: latest.phone }
        if (field.key === 'first') input.firstName = value
        else if (field.key === 'last') input.lastName = value
        else if (field.key === 'phone') input.phone = value
        const r = await window.ham.accounts.save(account.id, input)
        if (r.ok) previous.push({ account, value: fieldValue(account, field) })
        else failed++
        setProgress((p) => ({ label, done: i + 1, total: items.length, cancelling: p?.cancelling }))
      }
    } finally {
      bulkRunning.current = false
      setProgress(null)
    }
    const done = previous.length
    const text = `${stopped ? 'Stopped. ' : ''}Updated ${done} ${done === 1 ? 'account' : 'accounts'}${failed ? ` · ${failed} failed` : ''}`
    if (undoable && done > 0) {
      toast.success(text, {
        duration: 8000,
        action: { label: 'Undo', onClick: () => void runBulk(`Undoing ${field.name.toLowerCase()}`, field, previous, false) }
      })
    } else if (done > 0 || failed) {
      ;(failed ? toast.error : toast.success)(undoable ? text : `Changes undone on ${done} ${done === 1 ? 'account' : 'accounts'}`)
    }
  }

  const applyBulk = (field: FieldDef, plan: BulkPlan) => {
    void runBulk(
      `Updating ${field.name.toLowerCase()}`,
      field,
      plan.changes.map((c) => ({ account: c.account, value: c.next })),
      true
    )
  }

  const onPalette = (action: PaletteAction) => {
    switch (action) {
      case 'add':
        return setSheet({ kind: 'add', mode: 'one' })
      case 'paste':
        return setSheet({ kind: 'add', mode: 'paste' })
      case 'inbox':
        return setSheet({ kind: 'add', mode: 'inbox' })
      case 'settings':
      case 'link-inbox':
        return setSheet({ kind: 'settings' })
      case 'select-all':
        return pickAll()
      case 'new-group':
        return setSheet({ kind: 'new-group', ids: [...picked] })
      case 'new-tag':
        return setSheet({ kind: 'tag', tag: null, ids: [...picked] })
      case 'filter':
        return setFilterOpen(true)
    }
  }

  // Menu commands and shortcuts. Kept in a ref so the listener sees fresh state.
  menuRef.current = (command: MenuCommand) => {
    if (command.type === 'open-palette') {
      if (sheet === null && confirmSignOut === null) setPaletteOpen((o) => !o)
      return
    }
    if (command.type === 'add-account') {
      setPaletteOpen(false)
      return setSheet({ kind: 'add', mode: 'one' })
    }
    if (command.type === 'open-settings') {
      setPaletteOpen(false)
      return setSheet({ kind: 'settings' })
    }
    if (command.type === 'select-all') {
      // In a text field ⌘A selects its text; elsewhere it selects every account.
      if (isEditable(document.activeElement)) return void document.execCommand('selectAll')
      if (!overlayOpen) pickAll()
      return
    }
    if (command.type === 'filter') {
      if (!overlayOpen || filterOpen) setFilterOpen((o) => !o)
      return
    }
    if (overlayOpen) return
    switch (command.type) {
      case 'save':
        if (!showDashboard) formRef.current?.save()
        break
      case 'refresh':
        if (showDashboard) void window.ham.dashboard.reload()
        else void refresh()
        break
      case 'toggle-tab':
        if (signedIn) setTab((t) => (t === 'profile' ? 'web' : 'profile'))
        break
      case 'select-index': {
        const target = viewModel.order[command.index]
        if (target) select(target)
        break
      }
      case 'deselect-all':
        setPicked(new Set())
        break
      case 'toggle-pin': {
        const list = targets()
        setPinned(list, !list.every((a) => a.pinned))
        break
      }
      case 'move':
        move(command.direction)
        break
      case 'new-group':
        setSheet({ kind: 'new-group', ids: [...picked] })
        break
      case 'new-tag':
        setSheet({ kind: 'tag', tag: null, ids: [...picked] })
        break
      case 'sign-out':
        confirmRemove(targets())
        break
    }
  }

  // Esc reverts unsaved profile changes.
  // ⌘A / ⇧⌘A also live here so they work wherever the menu accelerator doesn't fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') {
        if (overlayOpen || isEditable(document.activeElement)) return
        e.preventDefault()
        if (e.shiftKey) setPicked(new Set())
        else pickAll()
        return
      }
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen) return
      if (formRef.current?.revert()) toast('Changes reverted')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen, viewModel.visible])

  if (!app) return <div className="app" />
  const shownSheet = sheetLatch.value
  const slackShown = slackLatch.value!

  const pickedAccounts = accounts.filter((a) => picked.has(a.id))

  return (
    <div className="app">
      <Sidebar
        groups={viewModel.groups}
        showSub={viewModel.showSub}
        order={viewModel.order}
        visible={viewModel.visible}
        filtering={viewModel.filtering}
        draggable={viewModel.draggable}
        accounts={accounts}
        tags={tags}
        filterOpen={filterOpen}
        onFilterOpen={setFilterOpen}
        onFilter={setFilter}
        onNewTag={() => {
          setFilterOpen(false)
          setSheet({ kind: 'tag', tag: null, ids: [], fromFilter: true })
        }}
        onTagMenu={(t) => void showTagMenu(t)}
        selectedId={selected?.id ?? null}
        picked={picked}
        inboxOn={inboxOn}
        mod={mod}
        view={app.view}
        progress={progress}
        onCancelProgress={() => {
          cancelBulk.current = true
          setProgress((p) => (p ? { ...p, cancelling: true } : p))
        }}
        onView={setView}
        onSelect={select}
        onTogglePick={togglePick}
        onExtendTo={extendTo}
        onReorder={reorder}
        onContextMenu={(a) => void showContextMenu(a)}
        onGroupMenu={(g) => void showGroupMenu(g)}
        onSelectAll={selectAll}
        onClearPicked={() => (setPicked(new Set()), setAnchor(null))}
        onAdd={() => setSheet({ kind: 'add', mode: 'one' })}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => setSheet({ kind: 'settings' })}
      />

      <main className="content">
        <div className="content-titlebar" />
        {app.update && (
          <div className="banner info update-banner">
            <span className="text">
              <strong>HAM {app.update.version} is out</strong>
            </span>
            <button className="btn" onClick={() => void window.ham.dismissUpdate()}>
              Later
            </button>
            <button className="btn btn-primary btn-small" onClick={() => void window.ham.openExternal(app.update!.url)}>
              Download
            </button>
          </div>
        )}

        <div className={`content-scroll${showDashboard ? ' locked' : ''}`}>
          {bulkMode ? (
            <div className="detail">
              <BulkPanel
                picked={pickedAccounts}
                busy={progress !== null}
                onClear={() => setPicked(new Set())}
                onPin={(pinned) => setPinned(pickedAccounts, pinned)}
                onGroup={() => void showGroupPicker(pickedAccounts)}
                tags={tags}
                onTags={() => void showTagPicker(pickedAccounts)}
                onSignInAgain={() => {
                  const ids = pickedAccounts.filter((a) => a.status === 'signed-out').map((a) => a.id)
                  void window.ham.accounts.signInAgain(ids)
                  toast(`Signing in ${ids.length} ${ids.length === 1 ? 'account' : 'accounts'} again`)
                }}
                onSignOut={() => confirmRemove(pickedAccounts)}
                onApply={applyBulk}
              />
            </div>
          ) : !selected ? (
            <div className="empty">
              <div className="glyph">
                <UserPlus size={34} strokeWidth={1.8} aria-hidden />
              </div>
              <h1>No accounts yet</h1>
              <button className="btn btn-primary btn-large" onClick={() => setSheet({ kind: 'add', mode: 'one' })}>
                Add accounts
              </button>
              {app.info.mock && <p className="demo-note">Demo mode: nothing is sent to auth.hackclub.com.</p>}
            </div>
          ) : (
            <Tabs.Root className={`detail${showDashboard ? ' wide' : ''}`} value={showDashboard ? 'web' : 'profile'} onValueChange={(v) => setTab(v as Tab)}>
              <header className="detail-header">
                <Avatar account={selected} size={60} />
                <div className="who">
                  <h1 className="selectable">{selected.fresh && pending ? selected.email : displayName(selected)}</h1>
                  <span className="email selectable">
                    {pending ? (status === 'failed' || status === 'stuck' ? 'Couldn’t add this account' : 'Adding this account') : selected.email}
                  </span>
                  <div className="tag-list" aria-label="Tags" role="group">
                    {tagsOf(selected).map((t) => (
                      <button key={t.id} className="tag-chip" aria-haspopup="menu" onClick={() => void showChipMenu(selected, t)}>
                        <TagDot tag={t} />
                        {t.name}
                      </button>
                    ))}
                    <button
                      className={`tag-chip add${tagsOf(selected).length ? ' icon-only' : ''}`}
                      aria-haspopup="menu"
                      aria-label="Add tag"
                      onClick={() => void showTagPicker([selected])}
                    >
                      {tagsOf(selected).length ? <Plus size={13} aria-hidden /> : <Tag size={12} aria-hidden />}
                      {!tagsOf(selected).length && 'Add tag'}
                    </button>
                  </div>
                </div>
                {signedIn && !showDashboard && (
                  <div className="header-actions">
                    <button className="btn" onClick={() => launchSlack(selected)}>
                      <MessageSquare size={15} aria-hidden />
                      Launch Slack
                    </button>
                    <button className="btn" onClick={() => void refresh()} disabled={refreshing}>
                      <RotateCw size={15} aria-hidden className={refreshing ? 'spin' : undefined} />
                      Refresh
                    </button>
                  </div>
                )}
              </header>

              {pending ? (
                <PendingPane
                  account={selected}
                  inbox={app.inbox}
                  now={now}
                  onRemove={() => void remove(selected)}
                  onOpenSettings={() => setSheet({ kind: 'settings' })}
                />
              ) : (
                <>
                  {signedOut && (
                    <div className="banner warn">
                      <Lock size={20} aria-hidden />
                      <span className="text">
                        <strong>This account is signed out</strong>
                        <span>Its session ended on {formatDate(selected.expiresAt)}.</span>
                      </span>
                      <button className="btn btn-primary" onClick={() => void window.ham.accounts.restart(selected.id)}>
                        Sign in again
                      </button>
                    </div>
                  )}

                  <Tabs.List className="tabs" aria-label="Account views">
                    <Tabs.Trigger className="tab" value="profile">
                      Profile
                    </Tabs.Trigger>
                    <Tabs.Trigger className="tab" value="web" disabled={!signedIn}>
                      Hack Club Auth
                    </Tabs.Trigger>
                  </Tabs.List>

                  <Tabs.Content value="profile" className="tab-panel">
                    <ProfileForm ref={formRef} account={selected} onSaved={onSaved} />
                    <LocalNameCard account={selected} />
                    <SessionCard account={selected} onSignOut={() => confirmRemove([selected])} />
                  </Tabs.Content>
                  <Tabs.Content value="web" className="tab-panel grow">
                    {showDashboard && (
                      <DashboardPane
                        account={selected}
                        covered={overlayOpen}
                        state={dashState}
                        notice={notice}
                        onDismissNotice={() => setNotice(null)}
                        onPoppedOut={() => setTab('profile')}
                      />
                    )}
                  </Tabs.Content>
                </>
              )}
            </Tabs.Root>
          )}
        </div>
      </main>

      {/* Over the dashboard the native view would hide toasts, so they move to the top. */}
      <Toaster position={showDashboard ? 'top-right' : 'bottom-right'} theme={app.theme} closeButton={false} duration={3200} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        accounts={accounts}
        tags={tags}
        selectedId={selected?.id ?? null}
        mod={mod}
        onSelectAccount={select}
        onAction={onPalette}
      />

      {shownSheet?.kind === 'add' && (
        <AddAccountsDialog
          key={sheetLatch.n}
          open={sheetLatch.open}
          mode={shownSheet.mode}
          accounts={accounts}
          inboxOn={inboxOn}
          onMode={(mode) => setSheet({ kind: 'add', mode })}
          onClose={() => setSheet(null)}
          onAdd={(emails) => void addEmails(emails)}
          onOpenSettings={() => setSheet({ kind: 'settings' })}
        />
      )}
      {shownSheet?.kind === 'settings' && <SettingsDialog key={sheetLatch.n} open={sheetLatch.open} app={app} onClose={() => setSheet(null)} />}

      {shownSheet?.kind === 'new-group' && (
        <GroupNameDialog
          key={sheetLatch.n}
          open={sheetLatch.open}
          initial=""
          count={shownSheet.ids.length}
          onClose={() => setSheet(null)}
          onSubmit={(name) => void createGroup(name, shownSheet.ids)}
        />
      )}
      {shownSheet?.kind === 'rename-group' && (
        <GroupNameDialog
          key={sheetLatch.n}
          open={sheetLatch.open}
          initial={shownSheet.group.name}
          count={0}
          onClose={() => setSheet(null)}
          onSubmit={(name) => {
            setSheet(null)
            void window.ham.groups.rename(shownSheet.group.id, name)
          }}
        />
      )}
      {shownSheet?.kind === 'local-name' && (
        <GroupNameDialog
          key={sheetLatch.n}
          open={sheetLatch.open}
          title="Local name"
          lead="Only kept in HAM. Leave it empty to clear it."
          initial={shownSheet.account.localName}
          placeholder={displayName(shownSheet.account)}
          submitLabel="Save"
          allowEmpty
          count={0}
          onClose={() => setSheet(null)}
          onSubmit={(name) => {
            setSheet(null)
            void window.ham.accounts.setLocalName(shownSheet.account.id, name)
          }}
        />
      )}
      {shownSheet?.kind === 'tag' && (
        <TagDialog
          key={sheetLatch.n}
          open={sheetLatch.open}
          tag={shownSheet.tag}
          count={shownSheet.ids.length}
          nextColor={TAG_COLORS[tags.length % TAG_COLORS.length]}
          onClose={() => setSheet(null)}
          onSubmit={(name, color) => void saveTag(shownSheet.tag, shownSheet.ids, name, color)}
          returnFocus={shownSheet.fromFilter ? () => document.querySelector<HTMLElement>('[data-filter-button]')?.focus() : undefined}
        />
      )}
      {signOutLatch.value && (
        <SignOutDialog
          key={signOutLatch.n}
          open={signOutLatch.open}
          accounts={signOutLatch.value}
          onCancel={() => setConfirmSignOut(null)}
          onConfirm={async () => {
            const list = signOutLatch.value!
            if (list.length === 1) return remove(list[0], true)
            // Many: close now and carry on in the background with a progress card.
            setConfirmSignOut(null)
            void removeMany(list)
          }}
        />
      )}

      {slackLatch.value && (
        <AlertDialog.Root key={slackLatch.n} open={slackLatch.open} onOpenChange={(o) => !o && setSlackConfirm(null)}>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="overlay" />
            <AlertDialog.Content className="sheet">
              <div className="sheet-head">
                <AlertDialog.Title>
                  {slackShown.slack.linked === false ? 'This account isn’t on Slack yet' : 'Open Hack Club Slack?'}
                </AlertDialog.Title>
                <AlertDialog.Description className="lead">
                  If {slackShown.email} isn’t on Slack yet, signing in through Hack Club creates a Hack Club Slack account for it and adds it to the workspace.
                </AlertDialog.Description>
              </div>
              <div className="dialog-actions">
                <AlertDialog.Cancel className="btn">Cancel</AlertDialog.Cancel>
                <AlertDialog.Action
                  className="btn btn-primary"
                  onClick={() => {
                    void window.ham.accounts.launchSlack(slackShown.id)
                    setSlackConfirm(null)
                  }}
                >
                  {slackShown.slack.linked === false ? 'Create and open Slack' : 'Open Slack'}
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </div>
  )
}
