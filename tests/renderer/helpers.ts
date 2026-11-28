// Shared fixtures for renderer tests: accounts and a stand-in for the preload bridge (window.ham).
import { vi } from 'vitest'
import type { Account } from '../../src/shared/types'

let n = 0
export function acct(p: Partial<Account> = {}): Account {
  n++
  return {
    id: `a${n}`,
    email: `user${n}@example.com`,
    localName: '',
    firstName: 'Fiona',
    lastName: `Hack${n}`,
    phone: '',
    hasLegalName: false,
    status: 'signed-in',
    fresh: false,
    pinned: false,
    groupId: null,
    tagIds: [],
    expiresAt: null,
    addedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString(),
    pending: null,
    slack: { linked: null, session: false, profile: {} },
    ...p
  }
}

/** Install a window.ham whose methods are vi.fn()s; `overrides` replace parts of it. Returns it for assertions. */
export function mockHam(overrides: Record<string, unknown> = {}) {
  const ham = {
    accounts: {
      save: vi.fn(async () => ({ ok: true })),
      saveSlack: vi.fn(async () => ({ ok: true })),
      setLocalName: vi.fn(async () => undefined),
      refresh: vi.fn(async () => ({ ok: true }))
    },
    ui: { contextMenu: vi.fn(async () => null) },
    ...overrides
  }
  ;(globalThis as unknown as { window: { ham: unknown } }).window.ham = ham
  return ham
}
