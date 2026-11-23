import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { Lock, MessageSquare, RotateCw, UserPlus } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { fieldValue, type FieldDef } from '@shared/fields'
import { isPending, type Account, type AppState, type DashboardNotice, type DashboardState, type MenuCommand, type SaveResult, type ViewSettings } from '@shared/types'
import { contextFor, type BulkPlan } from './bulk'
import { useTemplates } from './templates'
import { displayName, formatDate } from './util'
import { buildView, type TemplateValues } from './view'
import { AddAccountsDialog, type AddMode } from './components/AddAccountsDialog'
import { Avatar } from './components/Avatar'
import { BulkEditDialog } from './components/BulkEditDialog'
import { CommandPalette, type PaletteAction } from './components/CommandPalette'
import { DashboardPane } from './components/DashboardPane'
import { PendingPane } from './components/PendingPane'
import { ProfileForm, type ProfileFormHandle } from './components/ProfileForm'
import { SessionCard } from './components/SessionCard'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar, type BulkProgress } from './components/Sidebar'
import { SignOutDialog } from './components/SignOutDialog'

type Tab = 'profile' | 'web'
type Sheet = null | { kind: 'add'; mode: AddMode } | { kind: 'settings' } | { kind: 'bulk' }

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
  const [confirmSignOut, setConfirmSignOut] = useState<Account | null>(null)
  const [slackConfirm, setSlackConfirm] = useState<Account | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dashState, setDashState] = useState<DashboardState | null>(null)
  const [notice, setNotice] = useState<DashboardNotice | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [progress, setProgress] = useState<BulkProgress | null>(null)
  const [now, setNow] = useState(Date.now())
  const formRef = useRef<ProfileFormHandle>(null)
  const cancelBulk = useRef(false)
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
    () => (app ? buildView(accounts, app.view, tv, inboxOn, now) : { groups: [], order: [], showSub: true }),
    [app, accounts, tv, inboxOn, now]
  )

  const selected = accounts.find((a) => a.id === selectedId) ?? accounts.find((a) => a.id === viewModel.order[0]) ?? accounts[0] ?? null
  useEffect(() => {
    remembered.set('selected', selected?.id ?? null)
  }, [selected?.id])

  // Drop picked ids that no longer exist.
  useEffect(() => {
    if ([...picked].some((id) => !accounts.some((a) => a.id === id))) {
      setPicked(new Set([...picked].filter((id) => accounts.some((a) => a.id === id))))
    }
  }, [accounts, picked])

  const select = (id: string) => {
    setSelectedId(id)
    setNotice(null)
    setTab('profile')
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
  const selectAll = () => {
    if (picked.size === accounts.length) {
      setPicked(new Set())
      setAnchor(null)
    } else setPicked(new Set(accounts.map((a) => a.id)))
  }

  const status = selected?.status
  const pending = !!selected && isPending(selected.status)
  const signedOut = status === 'signed-out'
  const signedIn = status === 'signed-in'
  const showDashboard = tab === 'web' && signedIn
  const overlayOpen = sheet !== null || confirmSignOut !== null || paletteOpen || slackConfirm !== null
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

  const remove = async (account: Account) => {
    const { serverSignedOut, removed } = await window.ham.accounts.remove(account.id)
    setConfirmSignOut(null)
    if (!removed) return
    if (account.status === 'signed-in') {
      if (serverSignedOut) toast.success(`Signed out of ${account.email}`)
      else toast(`Removed ${account.email}`, { description: "HAM couldn't reach the server, so the session will expire on its own." })
    }
    if (selectedId === account.id) setSelectedId(null)
  }

  const launchSlack = (account: Account) => {
    if (account.slack.linked || account.slack.session) void window.ham.accounts.launchSlack(account.id)
    else setSlackConfirm(account)
  }

  /** Save one field across accounts, one at a time, with a progress card. */
  const runBulk = async (label: string, field: FieldDef, items: { account: Account; value: string }[], undoable: boolean) => {
    const previous: { account: Account; value: string }[] = []
    let failed = 0
    let stopped = false
    cancelBulk.current = false
    setProgress({ label, done: 0, total: items.length })
    for (let i = 0; i < items.length; i++) {
      if (cancelBulk.current) {
        stopped = true
        break
      }
      const { account, value } = items[i]
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
    setProgress(null)
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
    setSheet(null)
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
        return setPicked(new Set(accounts.map((a) => a.id)))
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
      case 'select-all':
        setPicked(new Set(accounts.map((a) => a.id)))
        break
      case 'sign-out':
        if (selected) setConfirmSignOut(selected)
        break
    }
  }

  // Esc reverts unsaved profile changes, else clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen) return
      if (formRef.current?.revert()) toast('Changes reverted')
      else if (picked.size > 0) setPicked(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen, picked])

  if (!app) return <div className="app" />

  const pickedAccounts = accounts.filter((a) => picked.has(a.id))

  return (
    <div className="app">
      <Sidebar
        groups={viewModel.groups}
        showSub={viewModel.showSub}
        order={viewModel.order}
        accounts={accounts}
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
        onSelectAll={selectAll}
        onClearPicked={() => (setPicked(new Set()), setAnchor(null))}
        onBulkEdit={() => setSheet({ kind: 'bulk' })}
        onSignInAgain={() => {
          const ids = pickedAccounts.filter((a) => a.status === 'signed-out').map((a) => a.id)
          void window.ham.accounts.signInAgain(ids)
          toast(`Signing in ${ids.length} ${ids.length === 1 ? 'account' : 'accounts'} again`)
        }}
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
          {!selected ? (
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
                    <SessionCard account={selected} onSignOut={() => setConfirmSignOut(selected)} />
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
        selectedId={selected?.id ?? null}
        mod={mod}
        onSelectAccount={select}
        onAction={onPalette}
      />

      {sheet?.kind === 'add' && (
        <AddAccountsDialog
          mode={sheet.mode}
          accounts={accounts}
          inboxOn={inboxOn}
          onMode={(mode) => setSheet({ kind: 'add', mode })}
          onClose={() => setSheet(null)}
          onAdd={(emails) => void addEmails(emails)}
          onOpenSettings={() => setSheet({ kind: 'settings' })}
        />
      )}
      {sheet?.kind === 'settings' && <SettingsDialog app={app} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'bulk' && <BulkEditDialog picked={pickedAccounts} busy={progress !== null} onClose={() => setSheet(null)} onApply={applyBulk} />}

      {confirmSignOut && <SignOutDialog account={confirmSignOut} onCancel={() => setConfirmSignOut(null)} onConfirm={() => remove(confirmSignOut)} />}

      {slackConfirm && (
        <AlertDialog.Root open onOpenChange={(o) => !o && setSlackConfirm(null)}>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="overlay" />
            <AlertDialog.Content className="sheet">
              <div className="sheet-head">
                <AlertDialog.Title>
                  {slackConfirm.slack.linked === false ? 'This account isn’t on Slack yet' : 'Open Hack Club Slack?'}
                </AlertDialog.Title>
                <AlertDialog.Description className="lead">
                  If {slackConfirm.email} isn’t on Slack yet, signing in through Hack Club creates a Hack Club Slack account for it and adds it to the workspace.
                </AlertDialog.Description>
              </div>
              <div className="dialog-actions">
                <AlertDialog.Cancel className="btn">Cancel</AlertDialog.Cancel>
                <AlertDialog.Action
                  className="btn btn-primary"
                  onClick={() => {
                    void window.ham.accounts.launchSlack(slackConfirm.id)
                    setSlackConfirm(null)
                  }}
                >
                  {slackConfirm.slack.linked === false ? 'Create and open Slack' : 'Open Slack'}
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </div>
  )
}
