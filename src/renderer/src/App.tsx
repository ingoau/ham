import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account, AppState, DashboardNotice, DashboardState, MenuCommand, SaveResult } from '@shared/types'
import { AlertIcon, CheckIcon, LockIcon, RefreshIcon, UserPlusIcon } from './icons'
import { displayName, matches } from './util'
import { AddAccountSheet } from './components/AddAccountSheet'
import { Avatar } from './components/Avatar'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DashboardPane } from './components/DashboardPane'
import { ProfileForm, type ProfileFormHandle } from './components/ProfileForm'
import { SessionCard } from './components/SessionCard'
import { Sidebar } from './components/Sidebar'

type Tab = 'profile' | 'web'
interface Toast {
  id: number
  text: string
  error?: boolean
}

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
  const [toasts, setToasts] = useState<Toast[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [dashState, setDashState] = useState<DashboardState | null>(null)
  const [notice, setNotice] = useState<DashboardNotice | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<ProfileFormHandle>(null)

  const toast = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text, error }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

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

  const refresh = async (account: Account | null = selected) => {
    if (!account || refreshing) return
    setRefreshing(true)
    try {
      const r = await window.ham.accounts.refresh(account.id)
      if (r.ok) toast('Profile is up to date')
      else if (r.reason === 'signed-out') toast('This account was signed out', true)
      else toast(r.message ?? "Couldn't reach auth.hackclub.com", true)
    } finally {
      setRefreshing(false)
    }
  }

  const onSaved = (result: SaveResult) => {
    if (result.ok) toast('Saved to auth.hackclub.com')
    else if (result.reason === 'signed-out') toast('Signed out. Sign in again to save.', true)
  }

  const openAdd = () => {
    setConfirmSignOut(null)
    setSheet({})
  }

  const signOut = async (account: Account) => {
    const { serverSignedOut } = await window.ham.accounts.signOut(account.id)
    setConfirmSignOut(null)
    toast(serverSignedOut ? `Signed out of ${account.email}` : `Removed ${account.email}. Its session will expire on its own.`)
    if (selectedId === account.id) setSelectedId(null)
  }

  // Menu commands and shortcuts. Kept in a ref so the listener above sees fresh state.
  const menuRef = useRef<(c: MenuCommand) => void>(() => {})
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
        if (tab === 'profile') formRef.current?.save()
        break
      case 'refresh':
        if (showDashboard) void window.ham.dashboard.reload()
        else void refresh()
        break
      case 'toggle-tab':
        if (selected && !signedOut) setTab((t) => (t === 'profile' ? 'web' : 'profile'))
        break
      case 'select-index': {
        const shown = accounts.filter((a) => matches(a, query))
        const target = shown[command.index]
        if (target) select(target.id)
        break
      }
      case 'sign-out':
        if (selected) setConfirmSignOut(selected)
        break
    }
  }

  // Esc closes the top overlay, or reverts unsaved changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (confirmSignOut) setConfirmSignOut(null)
      else if (sheet) setSheet(null)
      else if (formRef.current?.revert()) toast('Changes reverted')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmSignOut, sheet, toast])

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
            <button className="btn btn-primary" style={{ minHeight: 34 }} onClick={() => void window.ham.openExternal(app.update!.url)}>
              Download
            </button>
          </div>
        )}

        <div className="content-scroll" style={showDashboard ? { overflow: 'hidden' } : undefined}>
          {!selected ? (
            <div className="empty">
              <div className="glyph">
                <UserPlusIcon size={34} strokeWidth={1.8} />
              </div>
              <h1>No accounts yet</h1>
              <p>Sign in with your Hack Club account to see and edit it here. You can add as many accounts as you have.</p>
              <button className="btn btn-primary" style={{ minHeight: 44, padding: '0 22px', fontSize: 15 }} onClick={openAdd}>
                Add account
              </button>
              {app.info.mock && <p style={{ fontSize: 12 }}>Demo mode: nothing is sent to auth.hackclub.com.</p>}
            </div>
          ) : (
            <div className={`detail${showDashboard ? ' wide' : ''}`}>
              <header className="detail-header">
                <Avatar account={selected} size={60} />
                <div className="who">
                  <h1 className="selectable">{displayName(selected)}</h1>
                  <span className="email selectable">{selected.email}</span>
                </div>
                {!showDashboard && (
                  <button className="btn" onClick={() => void refresh()} disabled={signedOut || refreshing}>
                    <RefreshIcon size={15} className={refreshing ? 'spin' : undefined} />
                    Refresh
                  </button>
                )}
              </header>

              {signedOut && (
                <div className="banner warn">
                  <LockIcon size={20} />
                  <span className="text">
                    <strong>This account is signed out</strong>
                    <span>Its session on this computer has ended. Sign in again to edit it.</span>
                  </span>
                  <button
                    className="btn btn-primary"
                    style={{ background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'transparent' }}
                    onClick={() => setSheet({ reauth: { accountId: selected.id, email: selected.email } })}
                  >
                    Sign in again
                  </button>
                </div>
              )}

              <div className="tabs" role="tablist" aria-label="Account views">
                <button role="tab" className="tab" aria-selected={!showDashboard} onClick={() => setTab('profile')}>
                  Profile
                </button>
                <button role="tab" className="tab" aria-selected={showDashboard} disabled={signedOut} onClick={() => setTab('web')}>
                  Hack Club Auth
                </button>
              </div>

              {showDashboard ? (
                <DashboardPane
                  account={selected}
                  covered={overlayOpen}
                  state={dashState}
                  notice={notice}
                  onDismissNotice={() => setNotice(null)}
                  onPoppedOut={() => setTab('profile')}
                />
              ) : (
                <>
                  <ProfileForm ref={formRef} account={selected} onSaved={onSaved} />
                  <SessionCard account={selected} onSignOut={() => setConfirmSignOut(selected)} />
                </>
              )}
            </div>
          )}
        </div>

        <div className={`toasts${showDashboard ? ' top' : ''}`} aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast${t.error ? ' error' : ''}`} role="status">
              {t.error ? <AlertIcon /> : <CheckIcon />}
              {t.text}
            </div>
          ))}
        </div>
      </main>

      {sheet && (
        <AddAccountSheet
          key={sheet.reauth?.accountId ?? 'new'}
          reauth={sheet.reauth}
          onClose={() => setSheet(null)}
          onDone={(accountId, existing) => {
            setSheet(null)
            select(accountId)
            const acct = app.accounts.find((a) => a.id === accountId)
            if (sheet.reauth) toast('Signed in again')
            else if (existing && acct) toast(`${acct.email} is already in HAM`)
            else toast('Account added')
          }}
        />
      )}

      {confirmSignOut && (
        <ConfirmDialog
          title={confirmSignOut.status === 'signed-in' ? `Sign out of ${confirmSignOut.email}?` : `Remove ${confirmSignOut.email}?`}
          message={
            confirmSignOut.status === 'signed-in'
              ? 'This ends the session on auth.hackclub.com and removes the account from HAM. You can add it again later.'
              : 'This removes the account and its data from this computer. You can add it again later.'
          }
          confirmLabel={confirmSignOut.status === 'signed-in' ? 'Sign out' : 'Remove'}
          busyLabel="Signing out…"
          onCancel={() => setConfirmSignOut(null)}
          onConfirm={() => signOut(confirmSignOut)}
        />
      )}
    </div>
  )
}
