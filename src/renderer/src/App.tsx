import { useEffect, useRef, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Lock, RotateCw, UserPlus } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import type { Account, AppState, DashboardNotice, DashboardState, MenuCommand, SaveResult } from '@shared/types'
import { displayName, matches } from './util'
import { AddAccountSheet } from './components/AddAccountSheet'
import { Avatar } from './components/Avatar'
import { DashboardPane } from './components/DashboardPane'
import { ProfileForm, type ProfileFormHandle } from './components/ProfileForm'
import { SessionCard } from './components/SessionCard'
import { Sidebar } from './components/Sidebar'
import { SignOutDialog } from './components/SignOutDialog'

type Tab = 'profile' | 'web'

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

export function App() {
  const [app, setApp] = useState<AppState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() => remembered.get('selected'))
  const [tab, setTab] = useState<Tab>('profile')
  const [query, setQuery] = useState('')
  const [sheet, setSheet] = useState<null | { reauth?: { accountId: string; email: string } }>(null)
  const [confirmSignOut, setConfirmSignOut] = useState<Account | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [dashState, setDashState] = useState<DashboardState | null>(null)
  const [notice, setNotice] = useState<DashboardNotice | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<ProfileFormHandle>(null)
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
    })
  }, [])

  const accounts = app?.accounts ?? []
  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0] ?? null

  useEffect(() => {
    remembered.set('selected', selected?.id ?? null)
  }, [selected?.id])

  const select = (id: string) => {
    setSelectedId(id)
    setNotice(null)
  }

  const signedOut = selected?.status === 'signed-out'
  const showDashboard = tab === 'web' && !!selected && !signedOut
  const overlayOpen = sheet !== null || confirmSignOut !== null

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

  const openAdd = () => {
    setConfirmSignOut(null)
    setSheet({})
  }

  const signOut = async (account: Account) => {
    const { serverSignedOut } = await window.ham.accounts.signOut(account.id)
    setConfirmSignOut(null)
    if (serverSignedOut) toast.success(`Signed out of ${account.email}`)
    else toast(`Removed ${account.email}`, { description: "HAM couldn't reach the server, so the session will expire on its own." })
    if (selectedId === account.id) setSelectedId(null)
  }

  // Menu commands and shortcuts. Kept in a ref so the listener sees fresh state.
  menuRef.current = (command: MenuCommand) => {
    if (overlayOpen && command.type !== 'add-account') return
    switch (command.type) {
      case 'add-account':
        openAdd()
        break
      case 'focus-search':
        searchRef.current?.focus()
        searchRef.current?.select()
        break
      case 'save':
        if (!showDashboard) formRef.current?.save()
        break
      case 'refresh':
        if (showDashboard) void window.ham.dashboard.reload()
        else void refresh()
        break
      case 'toggle-tab':
        if (selected && !signedOut) setTab((t) => (t === 'profile' ? 'web' : 'profile'))
        break
      case 'select-index': {
        const target = accounts.filter((a) => matches(a, query))[command.index]
        if (target) select(target.id)
        break
      }
      case 'sign-out':
        if (selected) setConfirmSignOut(selected)
        break
    }
  }

  // Esc reverts unsaved profile changes (dialogs handle their own Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen) return
      if ((e.target as HTMLElement | null)?.id === 'search') return
      if (formRef.current?.revert()) toast('Changes reverted')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen])

  if (!app) return <div className="app" />

  return (
    <div className="app">
      <Sidebar
        ref={searchRef}
        accounts={accounts}
        selectedId={selected?.id ?? null}
        query={query}
        onQuery={setQuery}
        onSelect={select}
        onAdd={openAdd}
      />

      <main className="content">
        <div className="content-titlebar" />
        {app.update && (
          <div className="banner info update-banner">
            <span className="text">
              <strong>HAM {app.update.version} is out</strong>
              <span>You're on {app.info.version}. Download the new version from GitHub.</span>
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
              <p>Sign in with your Hack Club account to see and edit it here. You can add as many accounts as you have.</p>
              <button className="btn btn-primary btn-large" onClick={openAdd}>
                Add account
              </button>
              {app.info.mock && <p className="demo-note">Demo mode: nothing is sent to auth.hackclub.com.</p>}
            </div>
          ) : (
            <Tabs.Root
              className={`detail${showDashboard ? ' wide' : ''}`}
              value={showDashboard ? 'web' : 'profile'}
              onValueChange={(v) => setTab(v as Tab)}
            >
              <header className="detail-header">
                <Avatar account={selected} size={60} />
                <div className="who">
                  <h1 className="selectable">{displayName(selected)}</h1>
                  <span className="email selectable">{selected.email}</span>
                </div>
                {!showDashboard && (
                  <button className="btn" onClick={() => void refresh()} disabled={signedOut || refreshing}>
                    <RotateCw size={15} aria-hidden className={refreshing ? 'spin' : undefined} />
                    Refresh
                  </button>
                )}
              </header>

              {signedOut && (
                <div className="banner warn">
                  <Lock size={20} aria-hidden />
                  <span className="text">
                    <strong>This account is signed out</strong>
                    <span>Its session on this computer has ended. Sign in again to edit it.</span>
                  </span>
                  <button
                    className="btn btn-primary"
                    onClick={() => setSheet({ reauth: { accountId: selected.id, email: selected.email } })}
                  >
                    Sign in again
                  </button>
                </div>
              )}

              <Tabs.List className="tabs" aria-label="Account views">
                <Tabs.Trigger className="tab" value="profile">
                  Profile
                </Tabs.Trigger>
                <Tabs.Trigger className="tab" value="web" disabled={signedOut}>
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
            </Tabs.Root>
          )}
        </div>
      </main>

      {/* Over the dashboard the native view would hide toasts, so they move to the top. */}
      <Toaster position={showDashboard ? 'top-right' : 'bottom-right'} theme="system" closeButton={false} duration={3200} />

      {sheet && (
        <AddAccountSheet
          key={sheet.reauth?.accountId ?? 'new'}
          reauth={sheet.reauth}
          onClose={() => setSheet(null)}
          onDone={(accountId, existing) => {
            const acct = app.accounts.find((a) => a.id === accountId)
            if (sheet.reauth) toast.success('Signed in again')
            else if (existing && acct) toast(`${acct.email} is already in HAM`)
            else toast.success('Account added')
            setSheet(null)
            select(accountId)
          }}
        />
      )}

      {confirmSignOut && (
        <SignOutDialog account={confirmSignOut} onCancel={() => setConfirmSignOut(null)} onConfirm={() => signOut(confirmSignOut)} />
      )}
    </div>
  )
}
