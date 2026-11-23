import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Account, DashboardNotice, DashboardState } from '@shared/types'
import { BackIcon, HomeIcon, LockIcon, PopOutIcon, RefreshIcon } from '../icons'

interface Props {
  account: Account
  /** Hide the native view, e.g. while a sheet or dialog is open over it. */
  covered: boolean
  state: DashboardState | null
  notice: DashboardNotice | null
  onDismissNotice(): void
  onPoppedOut(): void
}

/**
 * The toolbar and frame for the embedded dashboard. The page itself is a
 * native WebContentsView that the main process places over `.dash-view`.
 */
export function DashboardPane({ account, covered, state, notice, onDismissNotice, onPoppedOut }: Props) {
  const viewRef = useRef<HTMLDivElement>(null)
  const shown = useRef(false)

  useLayoutEffect(() => {
    const el = viewRef.current
    if (!el) return
    const bounds = () => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    }
    if (covered) {
      if (shown.current) void window.ham.dashboard.hide()
      shown.current = false
      return
    }
    void window.ham.dashboard.show(account.id, bounds())
    shown.current = true
    const observer = new ResizeObserver(() => void window.ham.dashboard.setBounds(bounds()))
    observer.observe(el)
    const onResize = () => void window.ham.dashboard.setBounds(bounds())
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [account.id, covered, notice])

  // Detach the view when the tab closes.
  useEffect(
    () => () => {
      void window.ham.dashboard.hide()
      shown.current = false
    },
    []
  )

  const current = state && state.accountId === account.id ? state : null
  const path = current ? current.url.replace(/^https:\/\/auth\.hackclub\.com/, '') || '/' : '/'
  const activeNotice = notice && notice.accountId === account.id ? notice : null
  const extHost = activeNotice?.kind === 'external' ? safeHost(activeNotice.url) : ''

  return (
    <div className="dashboard">
      <div className="dash-toolbar">
        <button className="icon-btn" aria-label="Back" disabled={!current?.canGoBack} onClick={() => void window.ham.dashboard.back()}>
          <BackIcon />
        </button>
        <button className="icon-btn" aria-label="Home" onClick={() => void window.ham.dashboard.home()}>
          <HomeIcon />
        </button>
        <button className="icon-btn" aria-label="Reload" onClick={() => void window.ham.dashboard.reload()}>
          <RefreshIcon size={15} className={current?.loading ? 'spin' : undefined} />
        </button>
        <div className="dash-address" title="HAM only shows auth.hackclub.com">
          <LockIcon size={12} />
          <span>
            auth.hackclub.com<span style={{ color: 'var(--muted)' }}>{path === '/' ? '' : path}</span>
          </span>
        </div>
        <button
          className="btn"
          style={{ minHeight: 32, border: 0, background: 'transparent' }}
          onClick={() => {
            void window.ham.dashboard.popOut(account.id)
            onPoppedOut()
          }}
        >
          <PopOutIcon size={14} />
          Pop out
        </button>
      </div>

      {activeNotice?.kind === 'sso' && (
        <div className="banner warn compact" role="alert">
          <span className="text">
            <span>
              <strong>Signing in to other apps is turned off in HAM.</strong> To use this account with another app, sign
              in to Hack Club from your own browser.
            </span>
          </span>
          <button className="btn" onClick={onDismissNotice}>
            OK
          </button>
        </div>
      )}
      {activeNotice?.kind === 'external' && (
        <div className="banner info compact" role="alert">
          <span className="text">
            <span>
              <strong>This link leaves Hack Club Auth</strong> ({extHost}). HAM only shows auth.hackclub.com. In your
              browser you'll sign in separately.
            </span>
          </span>
          <button className="btn" onClick={onDismissNotice}>
            Stay here
          </button>
          <button
            className="btn btn-primary"
            style={{ minHeight: 34 }}
            onClick={() => {
              void window.ham.openExternal(activeNotice.url)
              onDismissNotice()
            }}
          >
            Open in browser
          </button>
        </div>
      )}

      <div className="dash-view" ref={viewRef}>
        {covered && <div className="placeholder">Hack Club Auth</div>}
      </div>
    </div>
  )
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
