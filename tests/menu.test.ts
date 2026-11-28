import { describe, expect, it, vi } from 'vitest'
import type { MenuCommand } from '@shared/types'

const built = vi.hoisted(() => ({ template: [] as { label?: string; submenu?: { label?: string; click?: (...a: unknown[]) => void }[] }[] }))
vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: class {},
  Menu: { buildFromTemplate: (t: typeof built.template) => (built.template = t), setApplicationMenu: () => {} },
  shell: {},
  webContents: { getFocusedWebContents: () => null },
  WebContentsView: class {}
}))
const { buildMenu, routeMenuCommand } = await import('../src/main/menu')

const selectAll: MenuCommand = { type: 'select-all' }
const pin: MenuCommand = { type: 'toggle-pin' }

describe('routeMenuCommand', () => {
  it('runs every command when HAM has focus', () => {
    expect(routeMenuCommand(selectAll, 'app', true)).toBe('send')
    expect(routeMenuCommand(pin, 'app', true)).toBe('send')
  })

  it('selects page text instead of every account outside HAM', () => {
    expect(routeMenuCommand(selectAll, 'other', true)).toBe('select-all')
    expect(routeMenuCommand(selectAll, 'embedded', true)).toBe('select-all')
    expect(routeMenuCommand({ type: 'deselect-all' }, 'other', true)).toBe('unselect')
  })

  it('ignores HAM shortcuts in other windows', () => {
    expect(routeMenuCommand(pin, 'other', true)).toBe('ignore')
    expect(routeMenuCommand({ type: 'select-index', index: 0 }, 'other', true)).toBe('ignore')
    expect(routeMenuCommand({ type: 'open-palette' }, 'other', true)).toBe('ignore')
    expect(routeMenuCommand({ type: 'refresh' }, 'other', true)).toBe('reload')
  })

  it('keeps account shortcuts working from a page embedded in the main window', () => {
    expect(routeMenuCommand(pin, 'embedded', true)).toBe('send')
  })

  it('brings HAM forward for app-wide shortcuts and menu-bar clicks', () => {
    expect(routeMenuCommand({ type: 'open-settings' }, 'other', true)).toBe('focus-and-send')
    expect(routeMenuCommand(pin, 'other', false)).toBe('focus-and-send')
  })
})

describe('File menu', () => {
  it('exports and imports the account list', () => {
    const send = vi.fn()
    buildMenu(send, () => null)
    const file = built.template.find((m) => m.label === 'File')!.submenu!
    const item = (label: string) => file.find((i) => i.label === label)!
    item('Export Accounts…').click!(undefined, undefined, { triggeredByAccelerator: false })
    item('Import Accounts…').click!(undefined, undefined, { triggeredByAccelerator: false })
    expect(send.mock.calls).toEqual([[{ type: 'export-accounts' }], [{ type: 'import-accounts' }]])
  })

  it('brings HAM forward to export or import from another window', () => {
    const send = vi.fn()
    const main = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), focus: vi.fn(), contentView: { children: [] }, webContents: {} }
    buildMenu(send, () => main as never)
    const file = built.template.find((m) => m.label === 'File')!.submenu!
    const slackWindow = {}
    file.find((i) => i.label === 'Import Accounts…')!.click!(undefined, slackWindow, { triggeredByAccelerator: false })
    expect(main.restore).toHaveBeenCalled()
    expect(main.focus).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({ type: 'import-accounts' })
  })
})
