// The main process side of window.ham: one handler per InvokeMethod. Only the
// app's own window may call in, and every argument is checked here.
import { clipboard, ipcMain, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC, type InvokeMethod } from '@shared/ipc'
import type { AppState, ContextMenuItem, FindResult, HamEvent, SlackProfile, SlackTokensResult, TagColor, Theme, UpdateInfo } from '@shared/types'
import type { AccountService } from './accounts'
import { hcaAccountExists, mockAccountExists } from './auth/check'
import { MockBackend, mockSlackTokens } from './auth/mock'
import type { DashboardManager } from './dashboard'
import type { InboxService } from './inbox'
import { checkAccounts } from './inbox-match'
import { bool, bounds, handlerFor, str, strArr } from './ipc-input'
import { isSafeExternalUrl } from './lockdown'
import { closeSlack, launchSlack } from './slack'
import { TokensFailed, TokensSignedOut, fetchSlackTokens } from './slack-tokens'
import { withDefaults, type Store } from './store'
import { checkForUpdate } from './updates'

export interface IpcContext {
  mock: boolean
  store: Store
  accounts: AccountService
  inbox: InboxService
  mainWindow(): BrowserWindow | null
  dashboard(): DashboardManager | null
  state(): AppState
  send(event: HamEvent): void
  broadcastState(): void
  applyTheme(theme: Theme): void
  update(): UpdateInfo | null
  setUpdate(update: UpdateInfo): void
}

type Handler = (...args: never[]) => unknown

/** Changes from the renderer: string values only, for at most 200 keys. */
function cleanSlackChanges(changes: unknown): SlackProfile {
  const out: SlackProfile = {}
  if (!changes || typeof changes !== 'object') return out
  for (const [k, v] of Object.entries(changes).slice(0, 200)) if (typeof v === 'string' && /^[\w.]{1,64}$/.test(k)) out[k] = v
  return out
}

export function registerIpc(ctx: IpcContext) {
  const { accounts, store, inbox, mock } = ctx
  const tokenRuns = new Map<string, Promise<SlackTokensResult>>()

  const handlers: Record<InvokeMethod, Handler> = {
    getState: () => ctx.state(),
    'accounts.add': (emails: unknown) => accounts.add(strArr(emails)),
    'accounts.submitCode': (id: unknown, code: unknown) => accounts.submitEmailCode(str(id), str(code)),
    'accounts.submitSecondFactor': (id: unknown, kind: unknown, code: unknown) =>
      accounts.submitSecondFactor(str(id), kind === 'backup' ? 'backup' : 'totp', str(code)),
    'accounts.restart': (id: unknown) => accounts.restart(str(id)),
    'accounts.signInAgain': (ids: unknown) => accounts.signInAgain(strArr(ids)),
    'accounts.remove': async (raw: unknown) => {
      const id = str(raw)
      ctx.dashboard()?.forget(id)
      const partition = accounts.partitionOf(id)
      if (partition) closeSlack(partition)
      return accounts.remove(id)
    },
    'accounts.refresh': (id: unknown) => accounts.refresh(str(id)),
    'accounts.save': (id: unknown, profile: { firstName?: unknown; lastName?: unknown; phone?: unknown } | null) =>
      accounts.save(str(id), {
        firstName: str(profile?.firstName),
        lastName: str(profile?.lastName),
        phone: str(profile?.phone)
      }),
    'accounts.saveSlack': (id: unknown, changes: unknown) => accounts.saveSlack(str(id), cleanSlackChanges(changes)),
    'accounts.launchSlack': async (raw: unknown) => {
      const id = str(raw)
      const account = accounts.list().find((a) => a.id === id)
      const partition = accounts.partitionOf(id)
      const backend = accounts.backendFor(id)
      if (!account || !partition || !backend || account.status !== 'signed-in') return
      launchSlack({
        partition,
        email: account.email,
        hasSession: await backend.hasSlackSession(),
        mock,
        onSignedIn: () => {
          if (mock) MockBackend.markSlackSession(partition)
          accounts.setSlack(id, { linked: true, session: true, keepSignedOut: false })
          void accounts.refreshSlack(id, true)
        },
        onSignedOut: () => {
          accounts.markSignedOut(id)
          ctx.send({ type: 'toast', text: `${account.email} is signed out. Sign in again to open Slack.`, kind: 'error' })
        }
      })
    },
    'accounts.signInSlack': (id: unknown) => accounts.signInSlack(str(id)),
    'accounts.signOutSlack': async (raw: unknown) => {
      const id = str(raw)
      const partition = accounts.partitionOf(id)
      if (!partition) return
      closeSlack(partition)
      await accounts.signOutSlack(id)
    },
    'accounts.slackTokens': (raw: unknown): Promise<SlackTokensResult> => {
      const id = str(raw)
      // One sign-in per account at a time: a second ask shares the first.
      let run = tokenRuns.get(id)
      if (!run) {
        run = slackTokens(id).finally(() => tokenRuns.delete(id))
        tokenRuns.set(id, run)
      }
      return run
    },
    'accounts.setLocalName': (id: unknown, name: unknown) => accounts.setLocalName(str(id), typeof name === 'string' ? name : ''),
    'accounts.setPinned': (ids: unknown, pinned: unknown) => accounts.setPinned(strArr(ids), bool(pinned)),
    'accounts.reorder': (ids: unknown) => accounts.reorder(strArr(ids)),
    'accounts.setGroup': (ids: unknown, groupId: unknown) => accounts.setGroup(strArr(ids), typeof groupId === 'string' ? groupId : null),
    'groups.create': (name: unknown, ids: unknown) => accounts.createGroup(str(name), strArr(ids)),
    'groups.rename': (id: unknown, name: unknown) => accounts.renameGroup(str(id), str(name)),
    'groups.remove': (id: unknown) => accounts.deleteGroup(str(id)),
    'groups.reorder': (ids: unknown) => accounts.reorderGroups(strArr(ids)),
    'accounts.setTag': (ids: unknown, tagId: unknown, on: unknown) => accounts.setTag(strArr(ids), str(tagId), bool(on)),
    'tags.create': (name: unknown, color: unknown, ids: unknown) => accounts.createTag(str(name), str(color) as TagColor, strArr(ids)),
    'tags.update': (id: unknown, patch: { name?: unknown; color?: unknown } | null) =>
      accounts.updateTag(str(id), {
        name: typeof patch?.name === 'string' ? patch.name : undefined,
        color: typeof patch?.color === 'string' ? (patch.color as TagColor) : undefined
      }),
    'tags.remove': (id: unknown) => accounts.deleteTag(str(id)),
    'tags.reorder': (ids: unknown) => accounts.reorderTags(strArr(ids)),
    'ui.contextMenu': (items: ContextMenuItem[]) =>
      new Promise<string | null>((resolve) => {
        const win = ctx.mainWindow()
        if (!win || !Array.isArray(items)) return resolve(null)
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
        Menu.buildFromTemplate(template).popup({ window: win, callback: () => setImmediate(() => resolve(chosen)) })
      }),
    copyText: (text: unknown) => clipboard.writeText(str(text)),
    'settings.setTheme': (theme: unknown) => {
      if (theme !== 'system' && theme !== 'light' && theme !== 'dark') return
      store.theme = theme
      ctx.applyTheme(theme)
      ctx.broadcastState()
    },
    'settings.setView': (view: unknown) => {
      store.view = store.pruneFilter(withDefaults(view && typeof view === 'object' ? view : {}))
      ctx.broadcastState()
    },
    'settings.setAutoSlack': (on: unknown) => {
      accounts.setAutoSlack(bool(on))
      ctx.broadcastState()
    },
    'settings.checkForUpdates': async () => {
      const result = await checkForUpdate()
      if (result.status === 'available') {
        ctx.setUpdate(result.update)
        store.dismissedUpdate = undefined
        ctx.broadcastState()
      }
      return result
    },
    'inbox.link': async (input: { email?: unknown; password?: unknown; host?: unknown } | null) => {
      const result = await inbox.link({ email: str(input?.email), password: str(input?.password), host: str(input?.host) })
      ctx.broadcastState()
      return result
    },
    'inbox.unlink': async () => {
      await inbox.unlink()
      ctx.broadcastState()
    },
    'inbox.findAddresses': async (): Promise<FindResult> => {
      const r = await inbox.findAddresses()
      // Addresses only seen in Slack mail might not have a Hack Club account: ask HCA.
      return r.ok ? { ok: true, addresses: await checkAccounts(r.addresses, mock ? mockAccountExists : hcaAccountExists) } : r
    },
    'dashboard.show': (accountId: unknown, raw: unknown) => {
      const b = bounds(raw)
      if (b) ctx.dashboard()?.show(str(accountId), b)
    },
    'dashboard.setBounds': (raw: unknown) => {
      const b = bounds(raw)
      if (b) ctx.dashboard()?.setBounds(b)
    },
    'dashboard.hide': () => ctx.dashboard()?.hide(),
    'dashboard.back': () => ctx.dashboard()?.back(),
    'dashboard.home': () => ctx.dashboard()?.home(),
    'dashboard.reload': () => ctx.dashboard()?.reload(),
    'dashboard.popOut': (accountId: unknown) => ctx.dashboard()?.popOut(str(accountId)),
    openExternal: async (url: unknown) => {
      if (typeof url === 'string' && isSafeExternalUrl(url)) await shell.openExternal(url)
    },
    dismissUpdate: () => {
      const update = ctx.update()
      if (update) store.dismissedUpdate = update.version
      ctx.broadcastState()
    }
  }

  async function slackTokens(id: string): Promise<SlackTokensResult> {
    const account = accounts.list().find((a) => a.id === id)
    const partition = accounts.partitionOf(id)
    if (!account || !partition || account.status !== 'signed-in') return { ok: false, reason: 'signed-out', message: 'Sign in again to get Slack tokens.' }
    if (!account.slack.linked && !account.slack.session) return { ok: false, reason: 'failed', message: 'This account isn’t on Slack yet. Launch Slack to join.' }
    if (mock) {
      await new Promise((r) => setTimeout(r, 1200))
      return { ok: true, tokens: mockSlackTokens(account.email) }
    }
    try {
      return { ok: true, tokens: await fetchSlackTokens(partition) }
    } catch (err) {
      if (err instanceof TokensSignedOut) {
        accounts.markSignedOut(id)
        return { ok: false, reason: 'signed-out', message: `${account.email} is signed out. Sign in again to get Slack tokens.` }
      }
      return { ok: false, reason: 'failed', message: err instanceof TokensFailed ? err.message : 'Couldn’t get Slack tokens. Try again.' }
    }
  }

  ipcMain.handle(IPC.invoke, (event, method: unknown, ...args: unknown[]) => {
    // Only the app's own window may call in.
    const win = ctx.mainWindow()
    if (!win || event.sender !== win.webContents) throw new Error('Unauthorized caller')
    const handler = handlerFor<Handler>(handlers, method)
    if (!handler) throw new Error(`Unknown method ${String(method)}`)
    return (handler as (...a: unknown[]) => unknown)(...args)
  })
}
