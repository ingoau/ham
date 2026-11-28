// The app menu. Its accelerators are HAM's keyboard shortcuts, so they show up
// in the menu and work on every platform (Cmd on macOS, Ctrl elsewhere).
//
// The menu belongs to the whole app, so its shortcuts also fire in Slack and
// popped-out Auth windows. HAM's commands act on the main window, so they only
// run when it has focus; elsewhere a shortcut does the browser's own thing or nothing.
import { app, BrowserWindow, Menu, shell, webContents, WebContentsView, type BaseWindow, type KeyboardEvent, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { MenuCommand } from '@shared/types'

/** Where keyboard focus is: HAM's UI, a page embedded in the main window, or another window. */
export type MenuFocus = 'app' | 'embedded' | 'other'
export type MenuAction = 'send' | 'focus-and-send' | 'select-all' | 'unselect' | 'reload' | 'ignore'

/** Shortcuts that make sense from any window, like Settings, bring the main window forward. */
const APP_WIDE = new Set<MenuCommand['type']>(['open-settings', 'add-account'])

/** A shortcut follows keyboard focus; other menu-bar clicks act on HAM, except Select All and Deselect All, which act on the focused page. */
export function routeMenuCommand(command: MenuCommand, focus: MenuFocus, byShortcut: boolean): MenuAction {
  if (focus === 'app') return 'send'
  // Select All in a web page selects its text, never every account.
  if (command.type === 'select-all') return 'select-all'
  if (command.type === 'deselect-all') return 'unselect'
  if (focus === 'embedded') return 'send'
  if (!byShortcut || APP_WIDE.has(command.type)) return 'focus-and-send'
  return command.type === 'refresh' ? 'reload' : 'ignore'
}

export function buildMenu(send: (command: MenuCommand) => void, mainWindow: () => BrowserWindow | null) {
  const isMac = process.platform === 'darwin'

  // On macOS the focused page can sit in a window that isn't the active one, so
  // only trust it when it belongs to the window the shortcut came from.
  const focusOf = (win: BaseWindow | undefined): { focus: MenuFocus; wc: WebContents | null } => {
    const main = mainWindow()
    if (main && !main.isDestroyed() && win === main) {
      const focused = webContents.getFocusedWebContents()
      const embedded = main.contentView.children.some((v) => v instanceof WebContentsView && v.webContents === focused)
      return embedded ? { focus: 'embedded', wc: focused } : { focus: 'app', wc: main.webContents }
    }
    return { focus: 'other', wc: win instanceof BrowserWindow ? win.webContents : null }
  }

  const focusMainAndSend = (command: MenuCommand) => {
    const main = mainWindow()
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) main.restore()
      main.focus()
    }
    send(command)
  }

  const run =
    (command: MenuCommand) =>
    (_item: unknown, win: BaseWindow | undefined, event: KeyboardEvent): void => {
      const { focus, wc } = focusOf(win)
      switch (routeMenuCommand(command, focus, Boolean(event?.triggeredByAccelerator))) {
        case 'send':
          return send(command)
        case 'focus-and-send':
          return focusMainAndSend(command)
        // With no page to act on (no window focused), fall back to HAM.
        case 'select-all':
          return wc ? wc.selectAll() : focusMainAndSend(command)
        case 'unselect':
          return wc ? wc.unselect() : focusMainAndSend(command)
        case 'reload':
          return wc?.reload()
      }
    }

  const accountSwitches: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: `Account ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: run({ type: 'select-index', index: i })
  }))

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            role: 'appMenu' as const,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { label: 'Settings…', accelerator: 'Cmd+,', click: run({ type: 'open-settings' }) },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Add Accounts…', accelerator: 'CmdOrCtrl+N', click: run({ type: 'add-account' }) },
        { type: 'separator' },
        { label: 'Import Accounts…', click: run({ type: 'import-accounts' }) },
        { label: 'Export Accounts…', click: run({ type: 'export-accounts' }) },
        ...(isMac ? [] : [{ type: 'separator' as const }, { label: 'Settings…', accelerator: 'Ctrl+,', click: run({ type: 'open-settings' }) }]),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        // Selects text in a field, otherwise every account (the renderer decides).
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: run({ type: 'select-all' }) },
        { label: 'Deselect All', accelerator: 'CmdOrCtrl+Shift+A', click: run({ type: 'deselect-all' }) },
        { type: 'separator' },
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+K', click: run({ type: 'open-palette' }) },
        { label: 'Find Account…', accelerator: 'CmdOrCtrl+F', click: run({ type: 'open-palette' }) }
      ]
    },
    {
      label: 'Account',
      submenu: [
        { label: 'Save Profile', accelerator: 'CmdOrCtrl+S', click: run({ type: 'save' }) },
        { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: run({ type: 'refresh' }) },
        {
          label: 'Switch Profile / Hack Club Auth',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: run({ type: 'toggle-tab' })
        },
        { type: 'separator' },
        { label: 'Pin / Unpin', accelerator: 'CmdOrCtrl+Shift+P', click: run({ type: 'toggle-pin' }) },
        { label: 'Move Up', accelerator: 'Alt+CmdOrCtrl+Up', click: run({ type: 'move', direction: 'up' }) },
        { label: 'Move Down', accelerator: 'Alt+CmdOrCtrl+Down', click: run({ type: 'move', direction: 'down' }) },
        { label: 'New Group…', accelerator: 'CmdOrCtrl+Shift+N', click: run({ type: 'new-group' }) },
        { label: 'New Tag…', accelerator: 'CmdOrCtrl+Shift+T', click: run({ type: 'new-tag' }) },
        { type: 'separator' },
        ...accountSwitches,
        { type: 'separator' },
        { label: 'Sign Out and Remove…', click: run({ type: 'sign-out' }) }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Filter Accounts…', accelerator: 'CmdOrCtrl+Shift+L', click: run({ type: 'filter' }) },
        { type: 'separator' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }, { type: 'separator' as const }]),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Hack Club Auth', click: () => void shell.openExternal('https://auth.hackclub.com') },
        { label: 'HAM on GitHub', click: () => void shell.openExternal('https://github.com/ingoau/ham') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'about' as const, label: 'About HAM' }])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
