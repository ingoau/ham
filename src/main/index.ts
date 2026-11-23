import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, screen, shell } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC, type InvokeMethod } from '@shared/ipc'
import type { AppState, Bounds, HamEvent, MenuCommand, ProfileInput, UpdateInfo } from '@shared/types'
import { AccountService } from './accounts'
import { AuthClient } from './auth/client'
import { MockBackend, seedMockData } from './auth/mock'
import { DashboardManager } from './dashboard'
import { isSafeExternalUrl } from './lockdown'
import { buildMenu } from './menu'
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
let dashboard: DashboardManager | null = null
let update: UpdateInfo | null = null

function send(event: HamEvent) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.event, event)
}

function state(): AppState {
  return {
    accounts: accounts.list(),
    info: { version: app.getVersion(), platform: process.platform, mock: MOCK },
    update: update && store.dismissedUpdate !== update.version ? update : null
  }
}

function broadcastState() {
  dashboard?.prune(new Set(accounts.list().map((a) => a.id)))
  send({ type: 'state', state: state() })
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
      expiresAt: s.expiresAt,
      addedAt: new Date(now - (3 - i) * 86_400_000).toISOString(),
      partition: s.partition
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
    'signIn.start': (email: string, accountId?: string) => accounts.start(email, accountId),
    'signIn.submitEmailCode': (attemptId: string, code: string) => accounts.submitEmailCode(attemptId, code),
    'signIn.submitSecondFactor': (attemptId: string, kind: 'totp' | 'backup', code: string) =>
      accounts.submitSecondFactor(attemptId, kind === 'backup' ? 'backup' : 'totp', code),
    'signIn.resend': (attemptId: string) => accounts.resend(attemptId),
    'signIn.cancel': (attemptId: string) => accounts.cancel(attemptId),
    'accounts.refresh': (accountId: string) => accounts.refresh(accountId),
    'accounts.save': (accountId: string, profile: ProfileInput) =>
      accounts.save(accountId, {
        firstName: String(profile?.firstName ?? ''),
        lastName: String(profile?.lastName ?? ''),
        phone: String(profile?.phone ?? '')
      }),
    'accounts.signOut': async (accountId: string) => {
      dashboard?.forget(accountId)
      return accounts.signOut(accountId)
    },
    'accounts.move': (accountId: string, toIndex: number) => accounts.move(accountId, Number(toIndex)),
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
  accounts = new AccountService(store, (partition) => (MOCK ? new MockBackend(partition) : new AuthClient(partition)), broadcastState)
  accounts.markExpired()

  registerIpc()
  buildMenu((command: MenuCommand) => send({ type: 'menu', command }))
  createWindow()

  void accounts.refreshAll(true)
  if (!MOCK) {
    update = await checkForUpdate()
    if (update) broadcastState()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
