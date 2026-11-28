import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { KeyRound, Lock, MessageSquare, Plus, RotateCw, Tag, UserPlus } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { FIXED_FIELDS, fieldValue, isSlackField, slackCustomFields, type FieldDef } from '@shared/fields'
import {
  isPending,
  type Account,
  type AccountFilter,
  type AccountGroup,
  type AccountTag,
  type AppState,
  type DashboardNotice,
  type DashboardState,
  type MenuCommand,
  type SaveResult,
  type SlackFieldDef,
  type ViewSettings
} from '@shared/types'
import { contextFor, setTemplateFields, type BulkPlan } from './bulk'
import { useStableCallback } from './hooks'
import { useLatched } from './latch'
import { accountMenu, chipMenu, choiceFor, groupItems, onSlack, sectionMenu, slackTargets, swapped, tagItems, tagMenu } from './menus'
import { useTemplates } from './templates'
import { useBulkJob } from './useBulkJob'
import { displayName, formatDate } from './util'
import { buildView, type GroupModel, type TemplateValues } from './view'
import { AppSheets, type Sheet } from './components/AppSheets'
import { Avatar } from './components/Avatar'
import { BulkPanel } from './components/BulkPanel'
import { CommandPalette, type PaletteAction } from './components/CommandPalette'
import { DashboardPane } from './components/DashboardPane'
import { DiscardDialog } from './components/DiscardDialog'
import type { ImportSummary } from './components/ImportDialog'
import { LocalNameCard } from './components/LocalNameCard'
import { PendingPane } from './components/PendingPane'
import { ProfileForm, type ProfileFormHandle } from './components/ProfileForm'
import { SessionCard } from './components/SessionCard'
import { SlackBulkDialog, SlackLaunchDialog } from './components/SlackDialogs'
import { SlackProfileCard, type SlackProfileHandle } from './components/SlackProfileCard'
import { setSlackCompletions } from './components/TemplateInput'
import { Sidebar, type SectionMove } from './components/Sidebar'
import { SignOutDialog } from './components/SignOutDialog'
import { TagDot } from './components/Tags'

type Tab = 'profile' | 'web'

const NO_ACCOUNTS: Account[] = []
const NO_GROUPS: AccountGroup[] = []
const NO_TAGS: AccountTag[] = []

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

const isEditable = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)

const busyToast = () => void toast('Wait for the current update to finish')

/** Render the list's template lines and template groups, by account id. */
function useViewTemplates(accounts: Account[], view: ViewSettings | undefined, custom: FieldDef[]): TemplateValues {
  const plan = useMemo(() => {
    const parts: [keyof TemplateValues, string][] = []
    if (view?.line1 === 'tpl') parts.push(['line1', view.line1Tpl])
    if (view?.line2 === 'tpl') parts.push(['line2', view.line2Tpl])
    if (view?.groupBy === 'tpl') parts.push(['group', view.groupTpl])
    const kinds = parts.map(([kind]) => kind)
    const jobs = parts.flatMap(([, tpl]) => accounts.map((a, i) => ({ tpl, ctx: contextFor(a, i + 1, accounts.length, '', custom) })))
    return { kinds, jobs }
  }, [accounts, view, custom])
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
  const [slackBulkConfirm, setSlackBulkConfirm] = useState<Account[] | null>(null)
  // What to do once unsaved profile edits are discarded.
  const [discard, setDiscard] = useState<{ run(): void } | null>(null)
  // Dialogs keep their content while they animate closed.
  const sheetLatch = useLatched(sheet)
  const signOutLatch = useLatched(confirmSignOut)
  const slackLatch = useLatched(slackConfirm)
  const slackBulkLatch = useLatched(slackBulkConfirm)
  const discardLatch = useLatched(discard)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dashState, setDashState] = useState<DashboardState | null>(null)
  const [notice, setNotice] = useState<DashboardNotice | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const formRef = useRef<ProfileFormHandle>(null)
  const slackRef = useRef<SlackProfileHandle>(null)
  // Only one background job (bulk edit, undo, bulk sign-out or Slack sign-in) at a time; they share the progress card.
  const bulk = useBulkJob()
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

  const accounts = app?.accounts ?? NO_ACCOUNTS
  const groups = app?.groups ?? NO_GROUPS
  const tags = app?.tags ?? NO_TAGS
  const inboxOn = app?.inbox.state === 'connected'

  // Slack's own profile fields come from Slack, so the field list follows the app state.
  // Every state update brings a fresh copy: key on the content so forms only reset when it changes.
  const slackFieldsKey = JSON.stringify(app?.slackFields ?? [])
  const customFields = useMemo(() => slackCustomFields(JSON.parse(slackFieldsKey) as SlackFieldDef[]), [slackFieldsKey])
  const allFieldDefs = useMemo(() => [...FIXED_FIELDS, ...customFields], [customFields])
  useEffect(() => {
    setSlackCompletions(customFields)
    setTemplateFields(customFields)
  }, [customFields])

  const tv = useViewTemplates(accounts, app?.view, customFields)
  // Countdowns tick in their own leaf components (Ticking), so the view is only rebuilt when the data changes.
  const viewModel = useMemo(
    () =>
      app
        ? buildView(accounts, app.view, tv, inboxOn, Date.now(), app.groups, new Set(app.tags.map((t) => t.id)))
        : { groups: [], order: [], visible: [], total: 0, filtering: false, showSub: true, draggable: false },
    [app, accounts, tv, inboxOn]
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

  /** Run something that takes the profile form away (another account, the selection, the web tab), asking first if it has unsaved edits. */
  const leaveProfile = (fn: () => void) => {
    if (formRef.current?.isDirty() || slackRef.current?.isDirty()) setDiscard({ run: fn })
    else fn()
  }

  /** Change the selection; going from none to some replaces the profile form with the bulk pane. */
  const changePicked = (fn: () => void) => (picked.size === 0 ? leaveProfile(fn) : fn())

  /** Open an account (on a tab). */
  const select = (id: string, to: Tab = 'profile') => {
    const run = () => {
      setSelectedId(id)
      setNotice(null)
      setTab(to)
      // Like Finder: a plain click on a row replaces the selection.
      setPicked(new Set())
      setAnchor(id)
    }
    if (id === selected?.id && to === 'profile') run()
    else leaveProfile(run)
  }

  const switchTab = (to: Tab) => (to === 'web' ? leaveProfile(() => setTab('web')) : setTab(to))

  /** Shift+arrow: select the range from the anchor to this account. */
  const extendTo = (id: string) => {
    const order = viewModel.order
    const base = anchor && order.includes(anchor) ? anchor : (selected?.id ?? id)
    const a = order.indexOf(base)
    const b = order.indexOf(id)
    if (a === -1 || b === -1) return
    changePicked(() => {
      setPicked(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)))
      setAnchor(base)
    })
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
    const next = swapped(ids, i, direction)
    reorder(
      viewModel.groups.flatMap((g) => (g === section ? next : g.rows.map((r) => r.account.id))),
      null
    )
  }

  const setView = useCallback((view: ViewSettings) => {
    setApp((s) => (s ? { ...s, view } : s))
    void window.ham.settings.setView(view)
  }, [])

  /** Your groups show when grouping is set to "My groups". */
  const showGroups = () => {
    if (app && app.view.groupBy !== 'none') setView({ ...app.view, groupBy: 'none' })
  }

  /** Move accounts into a group (null: out of their group). Shows the group if it's collapsed or hidden. */
  const moveToGroup = (list: Account[], groupId: string | null) => {
    const ids = new Set(list.map((a) => a.id))
    setApp((s) => (s ? { ...s, accounts: s.accounts.map((a) => (ids.has(a.id) ? { ...a, groupId, pinned: false } : a)) } : s))
    void window.ham.accounts.setGroup([...ids], groupId)
    showGroups()
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

  const handleGroupChoice = (choice: string | null, list: Account[]): boolean => {
    const target = choiceFor(choice, 'group')
    if (target === null) return false
    if (target === 'new') setSheet({ kind: 'new-group', ids: list.map((a) => a.id) })
    else moveToGroup(list, target === 'none' ? null : target)
    return true
  }

  const showGroupPicker = async (list: Account[]) => {
    handleGroupChoice(await window.ham.ui.contextMenu(groupItems(groups, list)), list)
  }

  /** Right-click on a section header. */
  const showGroupMenu = async (section: GroupModel) => {
    const members = section.rows.map((r) => r.account)
    const own = section.groupId ? groups.find((g) => g.id === section.groupId) : undefined
    const at = own ? groups.indexOf(own) : -1
    const choice = await window.ham.ui.contextMenu(sectionMenu(section, groups, own))
    if (!app) return
    switch (choice) {
      case 'toggle':
        return setView({ ...app.view, collapsed: { ...app.view.collapsed, [section.key || 'accounts']: section.open } })
      case 'select':
        return changePicked(() => setPicked(new Set(members.map((a) => a.id))))
      case 'slack-sign-in':
        return askSignInSlack(members)
      case 'rename':
        return own && setSheet({ kind: 'rename-group', group: own })
      case 'up':
      case 'down':
        if (!own) return
        return void window.ham.groups.reorder(swapped(groups.map((g) => g.id), at, choice))
      case 'delete':
        return own && deleteGroup(own)
      case 'new':
        return setSheet({ kind: 'new-group', ids: [] })
    }
  }

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

  /** A tag ticked on every account comes off them all; otherwise it goes on every one. */
  const handleTagChoice = (choice: string | null, list: Account[]): boolean => {
    const id = choiceFor(choice, 'tag')
    if (id === null) return false
    if (id === 'new') setSheet({ kind: 'tag', tag: null, ids: list.map((a) => a.id) })
    else setTag(list, id, !list.every((a) => a.tagIds.includes(id)))
    return true
  }

  const showTagPicker = async (list: Account[]) => {
    handleTagChoice(await window.ham.ui.contextMenu(tagItems(tags, list)), list)
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
    const choice = await window.ham.ui.contextMenu(tagMenu(tag, tags, members.some((a) => viewModel.visible.includes(a.id))))
    switch (choice) {
      case 'edit':
        setFilterOpen(false)
        return setSheet({ kind: 'tag', tag, ids: [], fromFilter: true })
      case 'select': {
        setFilterOpen(false)
        const shown = new Set(viewModel.visible)
        return changePicked(() => setPicked(new Set(members.map((a) => a.id).filter((id) => shown.has(id)))))
      }
      case 'up':
      case 'down':
        return void window.ham.tags.reorder(swapped(tags.map((t) => t.id), at, choice))
      case 'delete':
        return deleteTag(tag)
    }
  }

  /** Click on a tag chip in the detail header. */
  const showChipMenu = async (account: Account, tag: AccountTag) => {
    const choice = await window.ham.ui.contextMenu(chipMenu(tag))
    if (choice === 'remove') setTag([account], tag.id, false)
    else if (choice === 'filter' && app) setFilter({ ...app.view.filter, tags: [tag.id] })
    else if (choice === 'edit') setSheet({ kind: 'tag', tag, ids: [] })
  }

  const saveTag = async (sheetTag: AccountTag | null, ids: string[], name: string, color: AccountTag['color']) => {
    setSheet(null)
    if (sheetTag) void window.ham.tags.update(sheetTag.id, { name, color })
    else await window.ham.tags.create(name, color, ids)
  }

  const showContextMenu = async (account: Account) => {
    const many = picked.has(account.id) && picked.size > 1
    const list = many ? accounts.filter((a) => picked.has(a.id)) : [account]
    const choice = await window.ham.ui.contextMenu(accountMenu({ account, list, many, picked, groups, tags, draggable: viewModel.draggable }))
    if (handleGroupChoice(choice, list) || handleTagChoice(choice, list)) return
    switch (choice) {
      case 'open':
        return select(account.id)
      case 'local-name':
        return setSheet({ kind: 'local-name', account })
      case 'dashboard':
        return select(account.id, 'web')
      case 'slack':
        return launchSlack(account)
      case 'slack-sign-in':
        return askSignInSlack(list)
      case 'slack-sign-out':
        return void signOutSlack(account)
      case 'slack-tokens':
        return setSheet({ kind: 'slack-tokens', account })
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
      case 'export':
        return void exportAccounts(list)
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
    changePicked(() => {
      setPicked(next)
      setAnchor(id)
    })
  }
  /** Every account the filter shows (collapsed sections included). */
  const pickAll = () => {
    if (viewModel.visible.length > 0) changePicked(() => setPicked(new Set(viewModel.visible)))
  }
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
  const overlayOpen =
    sheet !== null || confirmSignOut !== null || paletteOpen || slackConfirm !== null || slackBulkConfirm !== null || filterOpen || discard !== null
  const mod = app?.info.platform === 'darwin' ? '⌘' : 'Ctrl+'

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

  /** Save every account (or `list`) to a file. */
  const exportAccounts = async (list: Account[] | null) => {
    const r = await window.ham.accounts.exportFile(list ? list.map((a) => a.id) : null)
    if (r.status === 'saved') toast.success(`Exported ${r.count} ${r.count === 1 ? 'account' : 'accounts'}`)
    else if (r.status === 'error') toast.error(r.message)
  }

  /** Pick an accounts file; a good one opens the import sheet. */
  const importAccounts = async () => {
    const r = await window.ham.accounts.importFile()
    if (r.status === 'ready') setSheet({ kind: 'import', summary: r })
    else if (r.status === 'error') toast.error('Couldn’t import', { description: r.message })
  }

  const confirmImport = async (summary: ImportSummary, applyView: boolean) => {
    const r = await window.ham.accounts.importConfirm(summary.token, applyView)
    setSheet(null)
    if (!r.ok) return void toast.error(r.message)
    if (r.added > 0) toast(`Adding ${r.added} ${r.added === 1 ? 'account' : 'accounts'}`)
    else if (applyView) toast.success('View settings applied')
    // Every new account was added some other way in the meantime.
    else toast('Already in HAM')
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

  /** Ask before signing out of (and removing) one account or a whole selection. */
  const confirmRemove = (list: Account[]) => {
    if (list.length === 0) return
    if (list.length > 1 && bulk.isRunning()) return busyToast()
    setConfirmSignOut(list)
  }

  /** Sign out of and remove several accounts in the background, a few at a time, with a progress card. */
  const removeMany = async (list: Account[]) => {
    const signedIn = list.filter((a) => a.status === 'signed-in').length
    const signingOut = signedIn > 0
    const outcome = await bulk.run({
      label: signingOut ? 'Signing out' : 'Removing',
      items: list,
      // Sign-out isn't rate limited, but keep it gentle on the server.
      concurrency: 4,
      fn: async (a) => {
        let r = await window.ham.accounts.remove(a.id)
        // A sign-in in progress is only cancelled by the first call (not removed, but "signed out"); the second removes it.
        if (!r.removed && r.serverSignedOut) r = await window.ham.accounts.remove(a.id)
        return r
      }
    })
    if (!outcome) return busyToast()
    const removed = outcome.results.flatMap((r) => (r.ok && r.value.removed ? [r] : []))
    const removedIds = new Set(removed.map((r) => r.item.id))
    const unreached = removed.filter((r) => !r.value.serverSignedOut).length
    const failed = outcome.results.length - removed.length
    setSelectedId((id) => (id && removedIds.has(id) ? null : id))
    const n = removedIds.size
    const stopped = outcome.stopped ? 'Stopped. ' : ''
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

  const signOutSlack = async (account: Account) => {
    try {
      await window.ham.accounts.signOutSlack(account.id)
      toast.success(`Signed out of Slack: ${account.email}`)
    } catch {
      toast.error('Couldn’t sign out of Slack')
    }
  }

  /** Sign in to Slack on several accounts, asking first if that would make Slack accounts. */
  const askSignInSlack = (list: Account[]) => {
    const targets = slackTargets(list)
    if (targets.length === 0) return
    if (targets.some((a) => a.slack.linked !== true)) setSlackBulkConfirm(targets)
    else void signInSlackMany(targets)
  }

  /** Sign accounts in to Slack in hidden windows, a few at a time, with a progress card. */
  const signInSlackMany = async (list: Account[]) => {
    if (list.length === 0) return
    const outcome = await bulk.run({
      label: 'Signing in to Slack',
      items: list,
      // The main process runs three at a time too.
      concurrency: 3,
      fn: (a) => window.ham.accounts.signInSlack(a.id)
    })
    if (!outcome) return busyToast()
    const count = (pass: (r: string) => boolean) => outcome.results.filter((r) => r.ok && pass(r.value)).length
    const signedIn = count((r) => r === 'signed-in' || r === 'already')
    const signedOut = count((r) => r === 'signed-out')
    const failed = outcome.results.length - signedIn - signedOut
    const stopped = outcome.stopped ? 'Stopped. ' : ''
    const problems = [failed && `${failed} couldn’t`, signedOut && `${signedOut} signed out of Hack Club`].filter(Boolean).join(' · ')
    const text = `${stopped}Signed in to Slack on ${signedIn} ${signedIn === 1 ? 'account' : 'accounts'}${problems ? ` · ${problems}` : ''}`
    const description = failed ? 'Launch Slack on those to finish.' : undefined
    ;(failed || signedOut ? toast.error : stopped ? toast : toast.success)(text, { description })
  }

  /** Save one field across accounts, one at a time, with a progress card. */
  const runBulk = async (label: string, field: FieldDef, items: { account: Account; value: string }[], undoable: boolean) => {
    const outcome = await bulk.run({
      label,
      items,
      fn: async ({ account, value }) => {
        if (field.local) {
          await window.ham.accounts.setLocalName(account.id, value)
          return true
        }
        if (isSlackField(field)) return (await window.ham.accounts.saveSlack(account.id, { [field.id]: value })).ok
        const latest = accounts.find((a) => a.id === account.id) ?? account
        const input = { firstName: latest.firstName, lastName: latest.lastName, phone: latest.phone }
        if (field.key === 'first') input.firstName = value
        else if (field.key === 'last') input.lastName = value
        else if (field.key === 'phone') input.phone = value
        return (await window.ham.accounts.save(account.id, input)).ok
      }
    })
    if (!outcome) return busyToast()
    // What each saved account had before, for Undo.
    const previous = outcome.results.flatMap((r) => (r.ok && r.value ? [{ account: r.item.account, value: fieldValue(r.item.account, field) }] : []))
    const failed = outcome.results.length - previous.length
    const done = previous.length
    const text = `${outcome.stopped ? 'Stopped. ' : ''}Updated ${done} ${done === 1 ? 'account' : 'accounts'}${failed ? ` · ${failed} failed` : ''}`
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
      case 'export':
        return void exportAccounts(null)
      case 'import':
        return void importAccounts()
    }
  }

  // Menu commands and shortcuts. Kept in a ref so the listener sees fresh state.
  menuRef.current = (command: MenuCommand) => {
    if (command.type === 'open-palette') {
      if (sheet === null && confirmSignOut === null && discard === null) setPaletteOpen((o) => !o)
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
        if (!showDashboard) {
          formRef.current?.save()
          slackRef.current?.save()
        }
        break
      case 'refresh':
        if (showDashboard) void window.ham.dashboard.reload()
        else void refresh()
        break
      case 'toggle-tab':
        if (signedIn) switchTab(tab === 'profile' ? 'web' : 'profile')
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
      case 'export-accounts':
        void exportAccounts(null)
        break
      case 'import-accounts':
        void importAccounts()
        break
    }
  }

  // Esc reverts unsaved profile changes.
  // ⌘A / ⇧⌘A also live here so they work wherever the menu accelerator doesn't fire.
  const onKey = useStableCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') {
      if (overlayOpen || isEditable(document.activeElement)) return
      e.preventDefault()
      if (e.shiftKey) setPicked(new Set())
      else pickAll()
      return
    }
    if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen) return
    const reverted = [formRef.current?.revert(), slackRef.current?.revert()].some(Boolean)
    if (reverted) toast('Changes reverted')
  })
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  if (!app) return <div className="app" />

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
        progress={bulk.progress}
        onCancelProgress={bulk.cancel}
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
                busy={bulk.progress !== null}
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
                fields={allFieldDefs}
                customFields={customFields}
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
            <Tabs.Root className={`detail${showDashboard ? ' wide' : ''}`} value={showDashboard ? 'web' : 'profile'} onValueChange={(v) => switchTab(v as Tab)}>
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
                    {onSlack(selected) && (
                      <button className="btn" onClick={() => setSheet({ kind: 'slack-tokens', account: selected })}>
                        <KeyRound size={15} aria-hidden />
                        Slack tokens
                      </button>
                    )}
                    <button className="btn" onClick={() => void refresh()} disabled={refreshing}>
                      <RotateCw size={15} aria-hidden className={refreshing ? 'spin' : undefined} />
                      Refresh
                    </button>
                  </div>
                )}
              </header>

              {pending ? (
                <PendingPane account={selected} inbox={app.inbox} onRemove={() => void remove(selected)} onOpenSettings={() => setSheet({ kind: 'settings' })} />
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
                    <SlackProfileCard
                      // One form per account: a save that finishes after switching can't touch another account's form.
                      key={selected.id}
                      ref={slackRef}
                      account={selected}
                      custom={customFields}
                      accounts={accounts}
                      onLaunch={() => launchSlack(selected)}
                      onSignOut={() => signOutSlack(selected)}
                      onSaved={(text, kind) => (kind === 'success' ? toast.success(text) : toast.error(text))}
                    />
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

      <AppSheets
        latch={sheetLatch}
        app={app}
        inboxOn={inboxOn}
        onSheet={setSheet}
        onAddEmails={(emails) => void addEmails(emails)}
        onCreateGroup={(name, ids) => void createGroup(name, ids)}
        onSaveTag={(tag, ids, name, color) => void saveTag(tag, ids, name, color)}
        onImport={confirmImport}
      />
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
        <SlackLaunchDialog
          key={slackLatch.n}
          open={slackLatch.open}
          account={slackLatch.value}
          onClose={() => setSlackConfirm(null)}
          onLaunch={(a) => void window.ham.accounts.launchSlack(a.id)}
        />
      )}
      {slackBulkLatch.value && (
        <SlackBulkDialog
          key={slackBulkLatch.n}
          open={slackBulkLatch.open}
          accounts={slackBulkLatch.value}
          onClose={() => setSlackBulkConfirm(null)}
          onSignIn={(list) => void signInSlackMany(list)}
        />
      )}
      {discardLatch.value && (
        <DiscardDialog
          key={discardLatch.n}
          open={discardLatch.open}
          onCancel={() => setDiscard(null)}
          onDiscard={() => {
            const next = discardLatch.value!
            setDiscard(null)
            next.run()
          }}
        />
      )}
    </div>
  )
}
