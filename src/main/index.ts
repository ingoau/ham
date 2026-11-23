import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeTheme, net, protocol, screen, shell, type MenuItemConstructorOptions } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC, type InvokeMethod } from '@shared/ipc'
import type { AppState, Bounds, ContextMenuItem, FindResult, HamEvent, ImapLinkInput, MenuCommand, ProfileInput, Theme, UpdateInfo, ViewSettings } from '@shared/types'
import { DEFAULT_VIEW } from '@shared/types'
import { AccountService } from './accounts'
import { AuthClient } from './auth/client'
import { hcaAccountExists, mockAccountExists } from './auth/check'
import { MockBackend, seedMockData } from './auth/mock'
import { DashboardManager } from './dashboard'
import { InboxService } from './inbox'
import { checkAccounts } from './inbox-match'
import { isSafeExternalUrl } from './lockdown'
import { buildMenu } from './menu'
import { launchSlack } from './slack'
import { Store } from './store'
import { checkForUpdate } from './updates'

const MOCK = process.env.HAM_MOCK === '1'

// Tests and demos run with their own data folder so they never touch real accounts.
if (process.env.HAM_USER_DATA) app.setPath('userData', process.env.HAM_USER_DATA)
else if (MOCK) app.setPath('userData', join(app.getPath('appData'), 'HAM (demo)'))

app.setName('HAM')
app.setAboutPanelOptions({
  applicationName: 'HAM',
  applicationVersion: app.getVersion(),
  copyright: 'Copyright © 2026 Ingo Wolf. MIT License.',
  credits: 'Hack Club Account Manager',
  website: 'https://github.com/ingoau/ham'
})
if (process.platform === 'win32') app.setAppUserModelId('com.ingoau.ham')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// The UI is served from app://ham/ rather than file://, so packaged builds can
// turn off the file protocol's extra privileges (see electronFuses).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])
const RENDERER_DIR = join(__dirname, '../renderer')

function serveRenderer() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const path = normalize(join(RENDERER_DIR, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)))
    if (url.host !== 'ham' || (path !== RENDERER_DIR && !path.startsWith(RENDERER_DIR + sep))) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(path).toString())
  })
}

let mainWindow: BrowserWindow | null = null
let store: Store
let accounts: AccountService
let inbox: InboxService
let dashboard: DashboardManager | null = null
let update: UpdateInfo | null = null

function send(event: HamEvent) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.event, event)
}

function state(): AppState {
  return {
    accounts: accounts.list(),
    groups: accounts.groups,
    info: { version: app.getVersion(), platform: process.platform, mock: MOCK },
    update: update && store.dismissedUpdate !== update.version ? update : null,
    theme: store.theme,
    view: store.view,
    inbox: inbox.status()
  }
}

// Many changes can land at once (a queue tick, an import): send one update.
let broadcastQueued = false
function broadcastState() {
  if (broadcastQueued) return
  broadcastQueued = true
  setImmediate(() => {
    broadcastQueued = false
    dashboard?.prune(new Set(accounts.list().map((a) => a.id)))
    send({ type: 'state', state: state() })
  })
}

function applyTheme(theme: Theme) {
  nativeTheme.themeSource = theme
}

function seedIfRequested() {
  if (!MOCK || process.env.HAM_MOCK_SEED !== '1' || store.accounts.length > 0) return
  const now = Date.now()
  seedMockData().forEach((s, i) => {
    store.upsert({
      id: `demo-${i + 1}`,
      email: s.email,
      ...s.profile,
      status: s.signedIn ? 'signed-in' : 'signed-out',
      fresh: false,
      pinned: false,
      groupId: null,
      expiresAt: s.expiresAt,
      addedAt: new Date(now - (3 - i) * 86_400_000).toISOString(),
      pending: null,
      slack: s.slack,
      partition: s.partition,
      attemptPath: null
    })
  })
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  const saved = store.window
  const fits =
    saved?.x !== undefined &&
    saved.y !== undefined &&
    screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return saved.x! >= a.x - 50 && saved.y! >= a.y - 50 && saved.x! < a.x + a.width - 100 && saved.y! < a.y + a.height - 100
    })

  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1120,
    height: saved?.height ?? 740,
    x: fits ? saved!.x : undefined,
    y: fits ? saved!.y : undefined,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'HAM',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1917' : '#ffffff',
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } } : { autoHideMenuBar: true }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  if (saved?.maximized) mainWindow.maximize()

  const win = mainWindow
  dashboard = new DashboardManager(win, (id) => accounts.partitionOf(id), send, MOCK)

  win.once('ready-to-show', () => win.show())
  win.on('focus', () => void accounts.refreshAll())

  const saveBounds = () => {
    if (win.isDestroyed() || win.isMinimized()) return
    const b = win.getNormalBounds()
    store.window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() }
  }
  win.on('close', saveBounds)

  // The app UI never navigates; links open in the system browser.
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadURL('app://ham/index.html')
  }

  win.on('closed', () => {
    mainWindow = null
    dashboard = null
  })
}

type Handler = (...args: never[]) => unknown

function registerIpc() {
  const handlers: Record<InvokeMethod, Handler> = {
    getState: () => state(),
    'accounts.add': (emails: string[]) => accounts.add(Array.isArray(emails) ? emails.map(String) : []),
    'accounts.submitCode': (id: string, code: string) => accounts.submitEmailCode(id, String(code)),
    'accounts.submitSecondFactor': (id: string, kind: 'totp' | 'backup', code: string) =>
      accounts.submitSecondFactor(id, kind === 'backup' ? 'backup' : 'totp', String(code)),
    'accounts.restart': (id: string) => accounts.restart(id),
    'accounts.signInAgain': (ids: string[]) => accounts.signInAgain(Array.isArray(ids) ? ids : []),
    'accounts.remove': async (id: string) => {
      dashboard?.forget(id)
      return accounts.remove(id)
    },
    'accounts.refresh': (id: string) => accounts.refresh(id),
    'accounts.save': (id: string, profile: ProfileInput) =>
      accounts.save(id, {
        firstName: String(profile?.firstName ?? ''),
        lastName: String(profile?.lastName ?? ''),
        phone: String(profile?.phone ?? '')
      }),
    'accounts.launchSlack': async (id: string) => {
      const account = accounts.list().find((a) => a.id === id)
      const partition = accounts.partitionOf(id)
      const backend = accounts.backendFor(id)
      if (!account || !partition || !backend || account.status !== 'signed-in') return
      launchSlack({
        partition,
        email: account.email,
        hasSession: await backend.hasSlackSession(),
        mock: MOCK,
        onSignedIn: () => {
          if (MOCK) MockBackend.markSlackSession(partition)
          accounts.setSlack(id, { linked: true, session: true })
        },
        onSignedOut: () => {
          accounts.markSignedOut(id)
          send({ type: 'toast', text: `${account.email} is signed out. Sign in again to open Slack.`, kind: 'error' })
        }
      })
    },
    'accounts.setPinned': (ids: string[], pinned: boolean) => accounts.setPinned(Array.isArray(ids) ? ids : [], pinned === true),
    'accounts.reorder': (ids: string[]) => accounts.reorder(Array.isArray(ids) ? ids.map(String) : []),
    'accounts.setGroup': (ids: string[], groupId: string | null) =>
      accounts.setGroup(Array.isArray(ids) ? ids.map(String) : [], typeof groupId === 'string' ? groupId : null),
    'groups.create': (name: string, ids: string[]) => accounts.createGroup(String(name ?? ''), Array.isArray(ids) ? ids.map(String) : []),
    'groups.rename': (id: string, name: string) => accounts.renameGroup(String(id), String(name ?? '')),
    'groups.remove': (id: string) => accounts.deleteGroup(String(id)),
    'groups.reorder': (ids: string[]) => accounts.reorderGroups(Array.isArray(ids) ? ids.map(String) : []),
    'ui.contextMenu': (items: ContextMenuItem[]) =>
      new Promise<string | null>((resolve) => {
        if (!mainWindow || !Array.isArray(items)) return resolve(null)
        let chosen: string | null = null
        const build = (list: ContextMenuItem[]): MenuItemConstructorOptions[] =>
          list.slice(0, 100).map((item) =>
            'id' in item
              ? {
                  label: String(item.label),
                  enabled: item.enabled !== false,
                  ...(item.checked !== undefined ? { type: 'checkbox' as const, checked: item.checked } : {}),
                  ...(item.accelerator ? { accelerator: item.accelerator, registerAccelerator: false } : {}),
                  click: () => (chosen = item.id)
                }
              : 'submenu' in item && Array.isArray(item.submenu)
                ? { label: String(item.label), submenu: build(item.submenu) }
                : { type: 'separator' as const }
          )
        const template = build(items)
        // The click handler runs before the menu's close callback.
        Menu.buildFromTemplate(template).popup({ window: mainWindow, callback: () => setImmediate(() => resolve(chosen)) })
      }),
    copyText: (text: string) => clipboard.writeText(String(text)),
    'settings.setTheme': (theme: Theme) => {
      if (theme !== 'system' && theme !== 'light' && theme !== 'dark') return
      store.theme = theme
      applyTheme(theme)
      broadcastState()
    },
    'settings.setView': (view: ViewSettings) => {
      store.view = { ...DEFAULT_VIEW, ...view }
      broadcastState()
    },
    'settings.checkForUpdates': async () => {
      const result = await checkForUpdate()
      if (result.status === 'available') {
        update = result.update
        store.dismissedUpdate = undefined
        broadcastState()
      }
      return result
    },
    'inbox.link': async (input: ImapLinkInput) => {
      const result = await inbox.link({ email: String(input?.email ?? ''), password: String(input?.password ?? ''), host: String(input?.host ?? '') })
      broadcastState()
      return result
    },
    'inbox.unlink': async () => {
      await inbox.unlink()
      broadcastState()
    },
    'inbox.findAddresses': async (): Promise<FindResult> => {
      const r = await inbox.findAddresses()
      // Addresses only seen in Slack mail might not have a Hack Club account: ask HCA.
      return r.ok ? { ok: true, addresses: await checkAccounts(r.addresses, MOCK ? mockAccountExists : hcaAccountExists) } : r
    },
    'dashboard.show': (accountId: string, bounds: Bounds) => dashboard?.show(accountId, bounds),
    'dashboard.setBounds': (bounds: Bounds) => dashboard?.setBounds(bounds),
    'dashboard.hide': () => dashboard?.hide(),
    'dashboard.back': () => dashboard?.back(),
    'dashboard.home': () => dashboard?.home(),
    'dashboard.reload': () => dashboard?.reload(),
    'dashboard.popOut': (accountId: string) => dashboard?.popOut(accountId),
    openExternal: async (url: string) => {
      if (typeof url === 'string' && isSafeExternalUrl(url)) await shell.openExternal(url)
    },
    dismissUpdate: () => {
      if (update) store.dismissedUpdate = update.version
      broadcastState()
    }
  }

  ipcMain.handle(IPC.invoke, (event, method: InvokeMethod, ...args: unknown[]) => {
    // Only the app's own window may call in.
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Unauthorized caller')
    const handler = handlers[method]
    if (!handler) throw new Error(`Unknown method ${String(method)}`)
    return (handler as (...a: unknown[]) => unknown)(...args)
  })
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.on('web-contents-created', (_event, contents) => {
  // Nothing in HAM may create <webview> tags.
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

app.whenReady().then(async () => {
  serveRenderer()
  store = new Store()
  seedIfRequested()
  applyTheme(store.theme)
  accounts = new AccountService(
    store,
    (partition) => (MOCK ? new MockBackend(partition) : new AuthClient(partition)),
    broadcastState,
    (text, kind) => send({ type: 'toast', text, kind })
  )
  let wasConnected = false
  inbox = new InboxService(
    store,
    (accountId, code, key) => accounts.onInboxCode(accountId, code, key),
    () => {
      const connected = inbox.connected
      if (connected && !wasConnected) accounts.onInboxConnected()
      wasConnected = connected
      broadcastState()
    },
    MOCK
  )
  accounts.setInbox(inbox)
  accounts.markExpired()

  registerIpc()
  buildMenu((command: MenuCommand) => send({ type: 'menu', command }))
  createWindow()

  void inbox.start()
  void accounts.resume()
  void accounts.refreshAll(true)
  if (!MOCK) {
    const result = await checkForUpdate()
    if (result.status === 'available') {
      update = result.update
      broadcastState()
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  accounts?.stop()
  void inbox?.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
