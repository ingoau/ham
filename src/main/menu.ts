// The app menu. Its accelerators are HAM's keyboard shortcuts, so they show up
// in the menu and work on every platform (Cmd on macOS, Ctrl elsewhere).
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/types'

export function buildMenu(send: (command: MenuCommand) => void) {
  const isMac = process.platform === 'darwin'
  const accountSwitches: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: `Account ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => send({ type: 'select-index', index: i })
  }))

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            role: 'appMenu' as const,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => send({ type: 'open-settings' }) },
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
        { label: 'Add Accounts…', accelerator: 'CmdOrCtrl+N', click: () => send({ type: 'add-account' }) },
        ...(isMac ? [] : [{ label: 'Settings…', accelerator: 'Ctrl+,', click: () => send({ type: 'open-settings' }) }]),
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
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+K', click: () => send({ type: 'open-palette' }) },
        { label: 'Find Account…', accelerator: 'CmdOrCtrl+F', click: () => send({ type: 'open-palette' }) },
        { label: 'Select All Accounts', accelerator: 'CmdOrCtrl+Shift+A', click: () => send({ type: 'select-all' }) }
      ]
    },
    {
      label: 'Account',
      submenu: [
        { label: 'Save Profile', accelerator: 'CmdOrCtrl+S', click: () => send({ type: 'save' }) },
        { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: () => send({ type: 'refresh' }) },
        {
          label: 'Switch Profile / Hack Club Auth',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => send({ type: 'toggle-tab' })
        },
        { type: 'separator' },
        ...accountSwitches,
        { type: 'separator' },
        { label: 'Sign Out and Remove…', click: () => send({ type: 'sign-out' }) }
      ]
    },
    {
      label: 'View',
      submenu: [
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
