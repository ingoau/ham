import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => electron.handlers.set(channel, fn) },
  app: { getPath: () => '/nonexistent', getVersion: () => '0.0.0' },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  Menu: {},
  shell: {},
  BrowserWindow: class {},
  nativeTheme: {},
  net: {},
  session: {}
}))

const { bool, bounds, handlerFor, num, str, strArr } = await import('../src/main/ipc-input')
const { registerIpc } = await import('../src/main/ipc')
const { IPC } = await import('../src/shared/ipc')
type IpcContext = import('../src/main/ipc').IpcContext

describe('input helpers', () => {
  it('str keeps strings, writes out numbers and drops the rest', () => {
    expect(str('a')).toBe('a')
    expect(str(3)).toBe('3')
    expect([undefined, null, {}, ['a'], true].map(str)).toEqual(['', '', '', '', ''])
  })

  it('strArr keeps the strings of a list, up to a limit', () => {
    expect(strArr(['a', 1, null, { toString: () => 'x' }, 'b'])).toEqual(['a', '1', 'b'])
    expect(strArr('a')).toEqual([])
    expect(strArr(undefined)).toEqual([])
    expect(strArr(['a', 'b', 'c'], 2)).toEqual(['a', 'b'])
  })

  it('bool is only true for true', () => {
    expect([true, 'true', 1, {}].map(bool)).toEqual([true, false, false, false])
  })

  it('num and bounds take finite numbers only', () => {
    expect(num(2.5)).toBe(2.5)
    expect([NaN, Infinity, '1', null].map(num)).toEqual([null, null, null, null])
    expect(bounds({ x: 1, y: 2, width: 3, height: 4, extra: 'x' })).toEqual({ x: 1, y: 2, width: 3, height: 4 })
    expect(bounds({ x: 1, y: 2, width: 3 })).toBeNull()
    expect(bounds({ x: 1, y: 2, width: NaN, height: 4 })).toBeNull()
    expect(bounds({ x: 1e9, y: 2, width: 3, height: 4 })).toBeNull()
    expect(bounds('0,0,1,1')).toBeNull()
  })

  it('handlerFor only finds own keys', () => {
    const handlers = { getState: () => 1 }
    expect(handlerFor(handlers, 'getState')).toBe(handlers.getState)
    expect(handlerFor(handlers, 'constructor')).toBeUndefined()
    expect(handlerFor(handlers, '__proto__')).toBeUndefined()
    expect(handlerFor(handlers, 'toString')).toBeUndefined()
    expect(handlerFor(handlers, 42)).toBeUndefined()
  })
})

describe('registerIpc', () => {
  function setup() {
    const wc = {}
    const accounts = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
      get: (target, key: string) => (target[key] ??= vi.fn())
    })
    const dashboard = { show: vi.fn(), setBounds: vi.fn() }
    const ctx = {
      mock: true,
      store: {},
      accounts,
      inbox: {},
      mainWindow: () => ({ webContents: wc }),
      dashboard: () => dashboard,
      state: () => ({ ok: true }),
      send: vi.fn(),
      broadcastState: vi.fn(),
      applyTheme: vi.fn(),
      update: () => null,
      setUpdate: vi.fn()
    } as unknown as IpcContext
    registerIpc(ctx)
    const handle = electron.handlers.get(IPC.invoke)!
    const call = (method: unknown, ...args: unknown[]) => handle({ sender: wc }, method, ...args)
    return { call, handle, accounts, dashboard }
  }

  it('only answers the main window', () => {
    const { handle } = setup()
    expect(() => handle({ sender: {} }, 'getState')).toThrow('Unauthorized caller')
  })

  it('rejects unknown and inherited method names', () => {
    const { call } = setup()
    expect(call('getState')).toEqual({ ok: true })
    for (const m of ['nope', 'constructor', 'hasOwnProperty', '__proto__']) expect(() => call(m)).toThrow(/Unknown method/)
  })

  it('cleans arguments before they reach the service', () => {
    const { call, accounts, dashboard } = setup()
    call('accounts.add', ['a@example.com', 5, null])
    expect(accounts.add).toHaveBeenCalledWith(['a@example.com', '5'])
    call('accounts.restart', 7)
    expect(accounts.restart).toHaveBeenCalledWith('7')
    call('accounts.refresh', { id: 'x' })
    expect(accounts.refresh).toHaveBeenCalledWith('')
    call('accounts.setPinned', 'not-a-list', 'yes')
    expect(accounts.setPinned).toHaveBeenCalledWith([], false)
    call('accounts.setGroup', ['a'], 3)
    expect(accounts.setGroup).toHaveBeenCalledWith(['a'], null)
    call('dashboard.show', 'a', { x: 0, y: 0, width: 'wide', height: 10 })
    call('dashboard.setBounds', null)
    expect(dashboard.show).not.toHaveBeenCalled()
    expect(dashboard.setBounds).not.toHaveBeenCalled()
    call('dashboard.show', 'a', { x: 0, y: 0, width: 100, height: 10 })
    expect(dashboard.show).toHaveBeenCalledWith('a', { x: 0, y: 0, width: 100, height: 10 })
  })
})
