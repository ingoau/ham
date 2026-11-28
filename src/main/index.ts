import { app, BrowserWindow, dialog, nativeTheme, net, protocol, screen, shell } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '@shared/ipc'
import type { AppState, HamEvent, MenuCommand, Theme, UpdateInfo } from '@shared/types'
import { AccountService } from './accounts'
import { AuthClient } from './auth/client'
import { MockBackend, seedMockData } from './auth/mock'
import { DashboardManager } from './dashboard'
import { InboxService } from './inbox'
import { registerIpc } from './ipc'
import { isSafeExternalUrl } from './lockdown'
import { buildMenu } from './menu'
import { cancelHiddenSlack, signInSlackHidden } from './slack'
import { cancelSlackTokenRuns } from './slack-tokens'
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

// A second copy only hands over to the first (see 'second-instance') and does nothing else.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

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
    tags: accounts.tags,
    slackFields: store.slackFields,
    info: { version: app.getVersion(), platform: process.platform, mock: MOCK },
    update: update && store.dismissedUpdate !== update.version ? update : null,
    theme: store.theme,
    view: store.view,
    inbox: inbox.status(),
    autoSlack: store.autoSlack
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
      localName: '',
      ...s.profile,
      status: s.signedIn ? 'signed-in' : 'signed-out',
      fresh: false,
      pinned: false,
      groupId: null,
      tagIds: [],
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
  // Windows shutdown or logoff: before-quit and will-quit never come, so write now.
  win.on('session-end', () => {
    saveBounds()
    store.flush()
  })

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
    cancelSlackTokenRuns()
    dashboard = null
    // Queued sign-ins first, so none takes a slot the cancelled ones free up.
    accounts.cancelSlackSignIns()
    cancelHiddenSlack()
  })
}

/** Say once if the saved accounts couldn't be used as they were. */
function reportStoreProblem(win: BrowserWindow) {
  const p = store.problem
  if (!p || (p.kind === 'corrupt' && p.restored)) return
  const options =
    p.kind === 'corrupt'
      ? { title: 'Couldn’t read your accounts', message: 'Couldn’t read your accounts', detail: `Backup: ${p.backup}` }
      : p.reason === 'newer'
        ? { title: 'Saved by a newer HAM', message: 'Saved by a newer version of HAM', detail: 'Changes won’t be saved.' }
        : { title: 'Couldn’t read your accounts', message: 'Couldn’t read your accounts', detail: 'Changes won’t be saved.' }
  void dialog.showMessageBox(win, { type: 'warning', buttons: ['OK'], ...options })
}

function start() {
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
    accounts.setSlackSignIn(
      MOCK
        ? async (partition) => {
            await new Promise((r) => setTimeout(r, 900))
            MockBackend.markSlackSession(partition)
            return 'signed-in'
          }
        : (partition) => signInSlackHidden(partition)
    )
    accounts.markExpired()

    registerIpc({
      mock: MOCK,
      store,
      accounts,
      inbox,
      mainWindow: () => mainWindow,
      dashboard: () => dashboard,
      state,
      send,
      broadcastState,
      applyTheme,
      update: () => update,
      setUpdate: (u) => (update = u)
    })
    buildMenu((command: MenuCommand) => send({ type: 'menu', command }), () => mainWindow)
    createWindow()
    const first = mainWindow
    first?.once('ready-to-show', () => reportStoreProblem(first))

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
      // Hidden Slack sign-in windows and Slack windows don't count.
      if (!mainWindow) createWindow()
    })
  })

  app.on('before-quit', () => {
    accounts?.stop()
    void inbox?.stop()
    store?.flush()
  })

  // Changes made while quitting (window bounds, the inbox closing) land after before-quit.
  app.on('will-quit', () => store?.flush())

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

if (primary) start()
