// Exposes a small, typed API to the renderer. The renderer never sees cookies
// or makes network requests: everything goes through the main process.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type HamApi, type InvokeMethod } from '@shared/ipc'
import type { HamEvent } from '@shared/types'

const call = <T>(method: InvokeMethod, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(IPC.invoke, method, ...args)

const api: HamApi = {
  getState: () => call('getState'),
  accounts: {
    add: (emails) => call('accounts.add', emails),
    submitCode: (id, code) => call('accounts.submitCode', id, code),
    submitSecondFactor: (id, kind, code) => call('accounts.submitSecondFactor', id, kind, code),
    restart: (id) => call('accounts.restart', id),
    signInAgain: (ids) => call('accounts.signInAgain', ids),
    remove: (id) => call('accounts.remove', id),
    refresh: (id) => call('accounts.refresh', id),
    save: (id, profile) => call('accounts.save', id, profile),
    launchSlack: (id) => call('accounts.launchSlack', id),
    setPinned: (ids, pinned) => call('accounts.setPinned', ids, pinned),
    reorder: (ids) => call('accounts.reorder', ids)
  },
  ui: {
    contextMenu: (items) => call('ui.contextMenu', items)
  },
  copyText: (text) => call('copyText', text),
  settings: {
    setTheme: (theme) => call('settings.setTheme', theme),
    setView: (view) => call('settings.setView', view),
    checkForUpdates: () => call('settings.checkForUpdates')
  },
  inbox: {
    link: (input) => call('inbox.link', input),
    unlink: () => call('inbox.unlink'),
    findAddresses: () => call('inbox.findAddresses')
  },
  dashboard: {
    show: (accountId, bounds) => call('dashboard.show', accountId, bounds),
    setBounds: (bounds) => call('dashboard.setBounds', bounds),
    hide: () => call('dashboard.hide'),
    back: () => call('dashboard.back'),
    home: () => call('dashboard.home'),
    reload: () => call('dashboard.reload'),
    popOut: (accountId) => call('dashboard.popOut', accountId)
  },
  openExternal: (url) => call('openExternal', url),
  dismissUpdate: () => call('dismissUpdate'),
  onEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: HamEvent) => listener(payload)
    ipcRenderer.on(IPC.event, handler)
    return () => ipcRenderer.removeListener(IPC.event, handler)
  }
}

contextBridge.exposeInMainWorld('ham', api)
