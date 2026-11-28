// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW, type Account } from '../../src/shared/types'
import { Sidebar, VIRTUAL_AFTER, listItems } from '../../src/renderer/src/components/Sidebar'
import { buildView } from '../../src/renderer/src/view'
import { acct, mockHam } from './helpers'

const noTpl = { line1: new Map(), line2: new Map(), group: new Map() }

function setup(accounts: Account[], over: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const view = { ...DEFAULT_VIEW, sortBy: 'manual' as const }
  const vm = buildView(accounts, view, noTpl, false, Date.now())
  const props = {
    groups: vm.groups,
    showSub: vm.showSub,
    order: vm.order,
    visible: vm.visible,
    filtering: vm.filtering,
    draggable: vm.draggable,
    accounts,
    tags: [],
    filterOpen: false,
    onFilterOpen: vi.fn(),
    onFilter: vi.fn(),
    onNewTag: vi.fn(),
    onTagMenu: vi.fn(),
    selectedId: accounts[0]?.id ?? null,
    picked: new Set<string>(),
    inboxOn: false,
    mod: 'Ctrl+',
    view,
    progress: null,
    onCancelProgress: vi.fn(),
    onView: vi.fn(),
    onSelect: vi.fn(),
    onTogglePick: vi.fn(),
    onExtendTo: vi.fn(),
    onSelectAll: vi.fn(),
    onClearPicked: vi.fn(),
    onReorder: vi.fn(),
    onContextMenu: vi.fn(),
    onGroupMenu: vi.fn(),
    onAdd: vi.fn(),
    onOpenPalette: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over
  }
  const utils = render(<Sidebar {...props} />)
  return { ...utils, props }
}

const rowButton = (a: Account) => document.getElementById(`account-${a.id}`)!

describe('Sidebar keyboard navigation', () => {
  beforeEach(() => {
    mockHam()
  })
  afterEach(cleanup)

  it('moves the open account with the arrow keys and focuses the row', () => {
    const list = [acct(), acct(), acct()]
    const { props } = setup(list)
    fireEvent.keyDown(rowButton(list[0]), { key: 'ArrowDown' })
    expect(props.onSelect).toHaveBeenCalledWith(list[1].id)
    expect(document.activeElement).toBe(rowButton(list[1]))
    fireEvent.keyDown(rowButton(list[1]), { key: 'ArrowUp' })
    expect(props.onSelect).toHaveBeenLastCalledWith(list[0].id)
  })

  it('stops at the ends of the list', () => {
    const list = [acct(), acct()]
    const { props } = setup(list)
    fireEvent.keyDown(rowButton(list[0]), { key: 'ArrowUp' })
    fireEvent.keyDown(rowButton(list[1]), { key: 'ArrowDown' })
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('leaves arrows with a modifier to the menu (Move Up/Down)', () => {
    const list = [acct(), acct()]
    const { props } = setup(list)
    fireEvent.keyDown(rowButton(list[0]), { key: 'ArrowDown', altKey: true, ctrlKey: true })
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('extends the selection with Shift+arrow and toggles it with Space', () => {
    const list = [acct(), acct(), acct()]
    const { props } = setup(list)
    fireEvent.keyDown(rowButton(list[0]), { key: 'ArrowDown', shiftKey: true })
    expect(props.onExtendTo).toHaveBeenCalledWith(list[1].id)
    expect(props.onSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(rowButton(list[2]), { key: ' ' })
    expect(props.onTogglePick).toHaveBeenCalledWith(list[2].id, false)
  })
})

describe('Sidebar clicks', () => {
  beforeEach(() => {
    mockHam()
  })
  afterEach(cleanup)

  it('opens on a plain click, toggles on ⌘/Ctrl-click and picks a range on Shift-click', () => {
    const list = [acct(), acct(), acct()]
    const { props } = setup(list)
    fireEvent.click(rowButton(list[1]))
    expect(props.onSelect).toHaveBeenCalledWith(list[1].id)
    fireEvent.click(rowButton(list[2]), { ctrlKey: true })
    expect(props.onTogglePick).toHaveBeenLastCalledWith(list[2].id, false)
    fireEvent.click(rowButton(list[0]), { shiftKey: true })
    expect(props.onTogglePick).toHaveBeenLastCalledWith(list[0].id, true)
    fireEvent.click(screen.getAllByRole('checkbox')[1], { shiftKey: true })
    expect(props.onTogglePick).toHaveBeenLastCalledWith(list[1].id, true)
  })

  it('marks picked rows and hides the current marker while picking', () => {
    const list = [acct(), acct()]
    setup(list, { picked: new Set([list[1].id]) })
    const rows = document.querySelectorAll('.account-row')
    expect(rows[1].classList.contains('checked')).toBe(true)
    expect(document.querySelector('[aria-current="true"]')).toBeNull()
    expect(screen.getByText('1 selected')).toBeTruthy()
  })
})

describe('Sidebar virtualisation', () => {
  // happy-dom has no layout: give the list a viewport and the rows a height.
  const sized = (prop: 'clientHeight' | 'offsetHeight', size: (el: HTMLElement) => number) =>
    vi.spyOn(HTMLElement.prototype, prop, 'get').mockImplementation(function (this: HTMLElement) {
      return size(this)
    })
  beforeEach(() => {
    mockHam()
    sized('clientHeight', (el) => (el.classList.contains('account-list') ? 600 : 0))
    sized('offsetHeight', (el) => (el.classList.contains('virtual-item') ? 56 : 0))
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders every row of a short list', () => {
    const list = Array.from({ length: 20 }, () => acct())
    setup(list)
    expect(document.querySelectorAll('.account-row')).toHaveLength(20)
    expect(document.querySelector('.account-list.virtual')).toBeNull()
  })

  /** Press on a row and move past the drag threshold; whether a drag started. */
  const dragStarts = async (row: Element) => {
    fireEvent.pointerDown(row, { button: 0, isPrimary: true, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(document, { clientX: 10, clientY: 40 })
    await act(async () => {})
    const started = document.querySelector('.account-list.is-dragging') !== null
    fireEvent.pointerUp(document, { clientX: 10, clientY: 40 })
    return started
  }

  it('drags rows of a short list', async () => {
    setup(Array.from({ length: 20 }, () => acct()))
    expect(await dragStarts(document.querySelector('.account-row')!)).toBe(true)
  })

  it('only renders some rows of a long list, and turns dragging off', async () => {
    const list = Array.from({ length: VIRTUAL_AFTER + 300 }, () => acct())
    const { props } = setup(list)
    expect(props.draggable).toBe(true)
    expect(document.querySelector('.account-list.virtual')).not.toBeNull()
    expect(await dragStarts(document.querySelector('.account-row')!)).toBe(false)
    expect(props.onReorder).not.toHaveBeenCalled()
    const shown = document.querySelectorAll('.account-row').length
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(list.length)
    // Keyboard navigation still works between rendered rows.
    fireEvent.keyDown(rowButton(list[0]), { key: 'ArrowDown' })
    expect(props.onSelect).toHaveBeenCalledWith(list[1].id)
  })

  it('keeps the open account rendered wherever it is', () => {
    const list = Array.from({ length: VIRTUAL_AFTER + 300 }, () => acct())
    const far = list[list.length - 1]
    setup(list, { selectedId: far.id })
    expect(rowButton(far)).toBeTruthy()
  })

  it('scrolls to the open account when the selection changes, not when it only moves', () => {
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    const list = Array.from({ length: VIRTUAL_AFTER + 300 }, () => acct())
    const far = list[list.length - 1]
    const { props, rerender } = setup(list, { selectedId: far.id })
    expect(scrollTo).toHaveBeenCalled()
    scrollTo.mockClear()

    // A re-sort moves the open account somewhere else far down: the list stays put.
    const moved = [...list.slice(0, -100), far, ...list.slice(-100, -1)]
    const vm = buildView(moved, props.view, noTpl, false, Date.now())
    rerender(<Sidebar {...props} accounts={moved} groups={vm.groups} order={vm.order} visible={vm.visible} />)
    expect(scrollTo).not.toHaveBeenCalled()

    const other = list[list.length - 50]
    rerender(<Sidebar {...props} accounts={moved} groups={vm.groups} order={vm.order} visible={vm.visible} selectedId={other.id} />)
    expect(scrollTo).toHaveBeenCalled()
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
  })

  it('has no drop hint for an empty group in a long list, where nothing drags', () => {
    const list = Array.from({ length: VIRTUAL_AFTER + 300 }, () => acct())
    const view = { ...DEFAULT_VIEW, sortBy: 'manual' as const }
    const vm = buildView(list, view, noTpl, false, Date.now())
    const empty = { ...vm.groups[0], key: 'g:empty', groupId: 'g-empty', name: 'Empty', rows: [], open: true }
    setup(list, { groups: [empty, ...vm.groups] })
    expect(screen.getByText('Empty')).toBeTruthy()
    expect(screen.queryByText('Drag accounts here')).toBeNull()
  })

  it('flattens sections into headers, hints and rows', () => {
    const a = acct({ pinned: true })
    const b = acct()
    const vm = buildView([a, b], DEFAULT_VIEW, noTpl, false, Date.now())
    const kinds = listItems(vm.groups, false, false).map((it) => it.kind)
    expect(kinds).toEqual(['header', 'row', 'header', 'row'])
  })
})
