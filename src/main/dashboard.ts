// The embedded Hack Club Auth dashboard: one WebContentsView per account,
// attached to the main window under the renderer's "Hack Club Auth" tab, or
// moved into its own window with Pop out. Every view is locked to
// auth.hackclub.com (see lockdown.ts).
import { BrowserWindow, WebContentsView, dialog, nativeTheme, shell, type Session, type WebContents } from 'electron'
import type { Bounds, HamEvent } from '@shared/types'
import { AUTH_ORIGIN } from './auth/flow'
import { isNavigationResource, isSafeExternalUrl, judgeNavigation, type NavigationVerdict } from './lockdown'
import { mockDashboardPage } from './mock-dashboard'

const HOME = `${AUTH_ORIGIN}/`

interface Policed {
  accountId: string
  popout: BrowserWindow | null
}

function securePrefs(partition: string): Electron.WebPreferences {
  return {
    partition,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    spellcheck: false,
    navigateOnDragDrop: false
  }
}

function themeBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1917' : '#ffffff'
}

export class DashboardManager {
  private readonly views = new Map<string, WebContentsView>()
  private readonly popouts = new Map<string, BrowserWindow>()
  private readonly policed = new Map<number, Policed>()
  private readonly lockedSessions = new WeakSet<Session>()
  private attached: string | null = null
  private lastNotice = { key: '', at: 0 }

  constructor(
    private readonly win: BrowserWindow,
    private readonly partitionOf: (accountId: string) => string | null,
    private readonly emit: (event: HamEvent) => void,
    private readonly mock: boolean
  ) {}

  show(accountId: string, bounds: Bounds) {
    const partition = this.partitionOf(accountId)
    if (!partition) return
    const existingPopout = this.popouts.get(accountId)
    if (existingPopout && !existingPopout.isDestroyed()) existingPopout.close()

    let view = this.views.get(accountId)
    if (!view) {
      view = this.createView(accountId, partition)
      this.views.set(accountId, view)
    }
    if (this.attached !== accountId) {
      this.detach()
      this.win.contentView.addChildView(view)
      this.attached = accountId
    }
    view.setBounds(round(bounds))
    view.setVisible(true)
    this.emitState(accountId, view.webContents)
  }

  setBounds(bounds: Bounds) {
    if (!this.attached) return
    this.views.get(this.attached)?.setBounds(round(bounds))
  }

  hide() {
    this.detach()
  }

  private detach() {
    if (!this.attached) return
    const view = this.views.get(this.attached)
    if (view) this.win.contentView.removeChildView(view)
    this.attached = null
  }

  private current(): WebContents | null {
    if (!this.attached) return null
    return this.views.get(this.attached)?.webContents ?? null
  }

  back() {
    const wc = this.current()
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  home() {
    const wc = this.current()
    if (wc) this.load(wc, HOME)
  }

  reload() {
    this.current()?.reload()
  }

  popOut(accountId: string) {
    const partition = this.partitionOf(accountId)
    if (!partition) return
    const view = this.views.get(accountId)
    const url = view && !view.webContents.isDestroyed() ? view.webContents.getURL() || HOME : HOME
    this.destroyView(accountId)

    const existing = this.popouts.get(accountId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return
    }
    const pop = new BrowserWindow({
      width: 1100,
      height: 800,
      minWidth: 480,
      minHeight: 400,
      title: 'Hack Club Auth',
      backgroundColor: themeBackground(),
      autoHideMenuBar: true,
      webPreferences: securePrefs(partition)
    })
    this.popouts.set(accountId, pop)
    pop.on('closed', () => this.popouts.delete(accountId))
    this.police(pop.webContents, accountId, pop)
    this.load(pop.webContents, url)
  }

  /** Close everything for an account, e.g. after it signs out. */
  forget(accountId: string) {
    this.destroyView(accountId)
    const pop = this.popouts.get(accountId)
    if (pop && !pop.isDestroyed()) pop.close()
  }

  /** Close views for accounts that no longer exist. */
  prune(accountIds: Set<string>) {
    for (const id of [...this.views.keys(), ...this.popouts.keys()]) {
      if (!accountIds.has(id)) this.forget(id)
    }
  }

  private destroyView(accountId: string) {
    const view = this.views.get(accountId)
    if (!view) return
    if (this.attached === accountId) this.detach()
    this.views.delete(accountId)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  private createView(accountId: string, partition: string): WebContentsView {
    const view = new WebContentsView({ webPreferences: securePrefs(partition) })
    view.setBackgroundColor(themeBackground())
    this.police(view.webContents, accountId, null)
    this.load(view.webContents, HOME)
    return view
  }

  private load(wc: WebContents, url: string) {
    if (this.mock) {
      void wc.loadURL(mockDashboardPage(new URL(url).pathname))
    } else {
      void wc.loadURL(url)
    }
  }

  // --- lockdown -----------------------------------------------------------

  private police(wc: WebContents, accountId: string, popout: BrowserWindow | null) {
    const id = wc.id
    this.policed.set(id, { accountId, popout })
    this.installLockdown(wc.session)

    const guard = (event: Electron.Event, url: string, isMainFrame = true) => {
      if (this.mock && url.startsWith('data:')) return
      const verdict = judgeNavigation(url)
      if (verdict === 'allow') {
        if (this.mock && isMainFrame) {
          event.preventDefault()
          this.load(wc, url)
        }
        return
      }
      event.preventDefault()
      if (isMainFrame) this.notify(id, verdict, url)
    }
    wc.on('will-navigate', (event) => guard(event, event.url, event.isMainFrame))
    wc.on('will-redirect', (event) => guard(event, event.url, event.isMainFrame))
    wc.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame) guard(event, event.url, false)
    })
    wc.setWindowOpenHandler(({ url }) => {
      const verdict = judgeNavigation(url)
      if (verdict === 'allow') this.load(wc, url)
      else this.notify(id, verdict, url)
      return { action: 'deny' }
    })
    wc.on('will-attach-webview', (event) => event.preventDefault())

    const state = () => this.emitState(accountId, wc)
    wc.on('did-navigate', state)
    wc.on('did-navigate-in-page', state)
    wc.on('did-start-loading', state)
    wc.on('did-stop-loading', state)
    wc.on('page-title-updated', () => {
      if (popout && !popout.isDestroyed()) popout.setTitle(`${wc.getTitle()} · HAM`)
    })
    wc.once('destroyed', () => this.policed.delete(id))
  }

  private installLockdown(ses: Session) {
    if (this.lockedSessions.has(ses)) return
    this.lockedSessions.add(ses)
    // HAM's own requests (net.request) have no webContentsId and pass straight
    // through; only pages inside the dashboard views are policed.
    ses.webRequest.onBeforeRequest((details, callback) => {
      const entry = details.webContentsId !== undefined ? this.policed.get(details.webContentsId) : undefined
      if (!entry || !isNavigationResource(details.resourceType)) return callback({})
      if (this.mock && details.url.startsWith('data:')) return callback({})
      const verdict = judgeNavigation(details.url)
      if (verdict === 'allow') return callback({})
      callback({ cancel: true })
      if (details.resourceType === 'mainFrame' && details.webContentsId !== undefined) {
        this.notify(details.webContentsId, verdict, details.url)
      }
    })
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
  }

  private notify(webContentsId: number, verdict: NavigationVerdict, url: string) {
    const entry = this.policed.get(webContentsId)
    if (!entry || verdict === 'allow') return
    const key = `${webContentsId}:${verdict}:${url}`
    if (this.lastNotice.key === key && Date.now() - this.lastNotice.at < 1500) return
    this.lastNotice = { key, at: Date.now() }

    const kind = verdict === 'block-sso' ? 'sso' : 'external'
    if (entry.popout && !entry.popout.isDestroyed()) {
      void this.popoutNotice(entry.popout, kind, url)
      return
    }
    this.emit({ type: 'dashboard-notice', notice: { kind, accountId: entry.accountId, url } })
  }

  private async popoutNotice(win: BrowserWindow, kind: 'sso' | 'external', url: string) {
    if (kind === 'sso') {
      await dialog.showMessageBox(win, {
        type: 'info',
        message: 'Signing in to other apps is turned off in HAM.',
        detail: 'To use this account with another app, sign in to Hack Club from your own browser.',
        buttons: ['OK']
      })
      return
    }
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      message: 'This link leaves Hack Club Auth.',
      detail: `HAM only shows auth.hackclub.com. Open ${hostOf(url)} in your browser? You'll sign in there separately.`,
      buttons: ['Open in Browser', 'Stay Here'],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 0 && isSafeExternalUrl(url)) void shell.openExternal(url)
  }

  private emitState(accountId: string, wc: WebContents) {
    if (wc.isDestroyed()) return
    const raw = wc.getURL()
    this.emit({
      type: 'dashboard-state',
      state: {
        accountId,
        url: raw.startsWith('data:') ? mockUrlOf(raw) : raw || HOME,
        canGoBack: wc.navigationHistory.canGoBack(),
        loading: wc.isLoading()
      }
    })
  }
}

function round(b: Bounds): Bounds {
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'this link'
  }
}

function mockUrlOf(dataUrl: string): string {
  let decoded = dataUrl
  try {
    decoded = decodeURIComponent(dataUrl)
  } catch {
    // keep the raw URL
  }
  const m = /data-path="([^"]*)"/.exec(decoded)
  return `${AUTH_ORIGIN}${m ? m[1] : '/'}`
}
