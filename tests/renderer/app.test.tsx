// @vitest-environment happy-dom
// The whole window against a fake preload bridge: unsaved-changes confirm and range selection.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW, type Account, type AppState, type HamEvent } from '../../src/shared/types'
import { App } from '../../src/renderer/src/App'
import { acct } from './helpers'

// The template sandbox is an iframe happy-dom can't load; nothing here needs templates.
vi.mock('../../src/renderer/src/templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/src/templates')>()),
  useTemplates: () => null
}))

/** Any window.ham method not given resolves undefined. */
function autoMock(given: Record<string, unknown>): unknown {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(given, {
    get(target, key) {
      if (key in target) {
        const v = target[key as string]
        return v && typeof v === 'object' && !Array.isArray(v) ? autoMock(v as Record<string, unknown>) : v
      }
      if (key === 'then') return undefined
      if (!cache.has(key)) cache.set(key, vi.fn(async () => undefined))
      return cache.get(key)
    }
  })
}

function state(accounts: Account[]): AppState {
  return {
    accounts,
    slackFields: [],
    groups: [],
    tags: [],
    info: { version: '0.0.0', platform: 'linux', mock: true },
    update: null,
    theme: 'light',
    view: { ...DEFAULT_VIEW, sortBy: 'manual' },
    inbox: { state: 'off', email: null, host: null, error: null },
    autoSlack: false
  }
}

let emit: (e: HamEvent) => void

async function mount(accounts: Account[], api: Record<string, unknown> = {}) {
  const ham = {
    getState: vi.fn(async () => state(accounts)),
    onEvent: vi.fn((cb: (e: HamEvent) => void) => {
      emit = cb
      return () => {}
    }),
    ui: { contextMenu: vi.fn(async () => null) },
    accounts: { save: vi.fn(async () => ({ ok: true })), ...api }
  }
  ;(window as unknown as { ham: unknown }).ham = autoMock(ham)
  localStorage.clear()
  render(<App />)
  await act(async () => {})
  return ham
}

const heading = () => document.querySelector('.detail-header h1')?.textContent
const row = (a: Account) => document.getElementById(`account-${a.id}`)!
const check = (a: Account) => row(a).closest('.account-row')!.querySelector('.row-check')!
const firstName = () => screen.getByLabelText('First name') as HTMLInputElement
const discardDialog = () => screen.queryByRole('alertdialog', { name: 'Discard unsaved changes?' })

describe('App: unsaved profile changes', () => {
  const ann = () => acct({ firstName: 'Ann', lastName: 'Lee' })
  const bo = () => acct({ firstName: 'Bo', lastName: 'Ray' })
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('switches straight away when nothing is edited', async () => {
    const [a, b] = [ann(), bo()]
    await mount([a, b])
    expect(heading()).toBe('Ann Lee')
    fireEvent.click(row(b))
    expect(discardDialog()).toBeNull()
    expect(heading()).toBe('Bo Ray')
  })

  it('asks before a click on another account throws edits away', async () => {
    const [a, b] = [ann(), bo()]
    await mount([a, b])
    fireEvent.change(firstName(), { target: { value: 'Annie' } })
    fireEvent.click(row(b))
    const dialog = discardDialog()!
    expect(dialog).toBeTruthy()
    expect(heading()).toBe('Ann Lee')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(heading()).toBe('Ann Lee')
    expect(firstName().value).toBe('Annie')

    fireEvent.click(row(b))
    fireEvent.click(within(discardDialog()!).getByRole('button', { name: 'Discard' }))
    expect(heading()).toBe('Bo Ray')
    expect(firstName().value).toBe('Bo')
  })

  it('asks before keyboard navigation and menu shortcuts switch accounts', async () => {
    const [a, b] = [ann(), bo()]
    await mount([a, b])
    fireEvent.change(firstName(), { target: { value: 'Annie' } })
    fireEvent.keyDown(row(a), { key: 'ArrowDown' })
    expect(discardDialog()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))

    act(() => emit({ type: 'menu', command: { type: 'select-index', index: 1 } } as HamEvent))
    expect(discardDialog()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(heading()).toBe('Bo Ray')
  })

  it('asks before picking accounts replaces the form with the bulk pane', async () => {
    const [a, b] = [ann(), bo()]
    await mount([a, b])
    fireEvent.change(firstName(), { target: { value: 'Annie' } })
    fireEvent.click(check(b))
    expect(discardDialog()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(document.querySelectorAll('.account-row.checked')).toHaveLength(0)
  })

  it('keeps edits through a background state update', async () => {
    const [a, b] = [ann(), bo()]
    await mount([a, b])
    fireEvent.change(firstName(), { target: { value: 'Annie' } })
    act(() => emit({ type: 'state', state: state([{ ...a, firstName: 'Anna', lastName: 'Li' }, b]) }))
    expect(firstName().value).toBe('Annie')
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe('Li')
  })

  it('still reverts with Escape', async () => {
    const [a, b] = [ann(), bo()]
    await mount([a, b])
    fireEvent.change(firstName(), { target: { value: 'Annie' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(firstName().value).toBe('Ann')
    fireEvent.click(row(b))
    expect(discardDialog()).toBeNull()
  })
})

describe('App: range selection', () => {
  afterEach(cleanup)

  it('picks the range between the anchor and a Shift-click', async () => {
    const list = [acct(), acct(), acct(), acct()]
    await mount(list)
    fireEvent.click(check(list[0]))
    fireEvent.click(check(list[2]), { shiftKey: true })
    const checked = [...document.querySelectorAll('.account-row.checked .row-main')].map((el) => el.id)
    expect(checked).toEqual([list[0], list[1], list[2]].map((a) => `account-${a.id}`))
    expect(screen.getByText('3 selected')).toBeTruthy()
  })

  it('extends from the open account with Shift+arrow', async () => {
    const list = [acct(), acct(), acct()]
    await mount(list)
    fireEvent.keyDown(row(list[0]), { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(row(list[1]), { key: 'ArrowDown', shiftKey: true })
    expect(document.querySelectorAll('.account-row.checked')).toHaveLength(3)
    fireEvent.keyDown(row(list[2]), { key: 'ArrowUp', shiftKey: true })
    expect(document.querySelectorAll('.account-row.checked')).toHaveLength(2)
  })
})

describe('App: importing', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('says so when every new account was added in the meantime', async () => {
    const importConfirm = vi.fn(async () => ({ ok: true, added: 0 }))
    await mount([acct()], { importFile: async () => ({ status: 'ready', token: 't', added: 1, existing: 0, hasView: false }), importConfirm })
    await act(async () => emit({ type: 'menu', command: { type: 'import-accounts' } } as HamEvent))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add 1 account' }))
    })
    expect(importConfirm).toHaveBeenCalledWith('t', false)
    expect(await screen.findByText('Already in HAM')).toBeTruthy()
  })
})
