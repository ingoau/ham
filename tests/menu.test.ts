import { describe, expect, it, vi } from 'vitest'
import type { MenuCommand } from '@shared/types'

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, Menu: {}, shell: {}, webContents: {}, WebContentsView: class {} }))
const { routeMenuCommand } = await import('../src/main/menu')

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
