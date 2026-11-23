// Exposes a small, typed API to the renderer. The renderer never sees cookies
// or makes network requests: everything goes through the main process.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type HamApi, type InvokeMethod } from '@shared/ipc'
import type { HamEvent } from '@shared/types'

const call = <T>(method: InvokeMethod, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(IPC.invoke, method, ...args)

const api: HamApi = {
  getState: () => call('getState'),
  signIn: {
    start: (email, accountId) => call('signIn.start', email, accountId),
    submitEmailCode: (attemptId, code) => call('signIn.submitEmailCode', attemptId, code),
    submitSecondFactor: (attemptId, kind, code) => call('signIn.submitSecondFactor', attemptId, kind, code),
    resend: (attemptId) => call('signIn.resend', attemptId),
    cancel: (attemptId) => call('signIn.cancel', attemptId)
  },
  accounts: {
    refresh: (accountId) => call('accounts.refresh', accountId),
    save: (accountId, profile) => call('accounts.save', accountId, profile),
    signOut: (accountId) => call('accounts.signOut', accountId),
    move: (accountId, toIndex) => call('accounts.move', accountId, toIndex)
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
