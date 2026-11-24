import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SlackInfo } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
const { Store } = await import('../src/main/store')
const { AccountService } = await import('../src/main/accounts')
type Backend = import('../src/main/auth/backend').AuthBackend

/** Slack sessions by partition, shared by the fake backends. */
let sessions: Record<string, boolean> = {}

function fakeBackend(partition: string): Backend {
  return {
    hasSlackSession: async () => sessions[partition] === true,
    readSlack: async () => (sessions[partition] ? { kind: 'ok', userId: 'U1', profile: {}, fields: [], users: {} } : { kind: 'signed-out' }),
    signOutSlack: async () => {
      sessions[partition] = false
    }
  } as unknown as Backend
}

function setup(accounts: { id: string; status?: 'signed-in' | 'signed-out'; slack?: Partial<SlackInfo> }[], autoSlack = false) {
  sessions = {}
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'ham-test-')), 'accounts.json'))
  store.autoSlack = autoSlack
  for (const a of accounts) {
    store.upsert({
      id: a.id,
      email: `${a.id}@example.com`,
      localName: '',
      firstName: '',
      lastName: '',
      phone: '',
      hasLegalName: false,
      status: a.status ?? 'signed-in',
      fresh: false,
      pinned: false,
      groupId: null,
      tagIds: [],
      expiresAt: null,
      addedAt: new Date().toISOString(),
      pending: null,
      slack: { linked: true, session: false, profile: {}, ...a.slack },
      partition: `p-${a.id}`,
      attemptPath: null
    })
  }
  const service = new AccountService(store, fakeBackend, () => {}, () => {})
  let running = 0
  let most = 0
  const signIn = vi.fn(async (partition: string) => {
    running++
    most = Math.max(most, running)
    await new Promise((r) => setTimeout(r, 5))
    running--
    sessions[partition] = true
    return 'signed-in' as const
  })
  service.setSlackSignIn(signIn)
  return { store, service, signIn, most: () => most }
}

describe('Slack sign-in', () => {
  it('signs in, three at a time', async () => {
    const { store, service, most } = setup(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })))
    const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => service.signInSlack(id)))
    expect(results).toEqual(['signed-in', 'signed-in', 'signed-in', 'signed-in', 'signed-in'])
    expect(most()).toBe(3)
    expect(store.find('a')?.slack.session).toBe(true)
  })

  it('skips accounts that already have a session or are signed out of Hack Club', async () => {
    const { service, signIn } = setup([{ id: 'a' }, { id: 'b', status: 'signed-out' }])
    sessions['p-a'] = true
    expect(await service.signInSlack('a')).toBe('already')
    expect(await service.signInSlack('b')).toBe('signed-out')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('reports a sign-in that left no Slack cookie as failed', async () => {
    const { service, signIn, store } = setup([{ id: 'a' }])
    signIn.mockImplementationOnce(async () => 'signed-in')
    expect(await service.signInSlack('a')).toBe('failed')
    expect(store.find('a')?.slack.session).toBe(false)
  })
})

describe('automatic Slack sign-in', () => {
  it('does nothing while the setting is off', async () => {
    const { service, signIn } = setup([{ id: 'a' }])
    service.autoSignInSlack()
    await new Promise((r) => setTimeout(r, 20))
    expect(signIn).not.toHaveBeenCalled()
  })

  it('only signs in accounts already on Slack and not signed out of it in HAM', async () => {
    const { service, signIn } = setup(
      [{ id: 'on' }, { id: 'unknown', slack: { linked: null } }, { id: 'none', slack: { linked: false } }, { id: 'out', slack: { keepSignedOut: true } }, { id: 'hca-out', status: 'signed-out' }],
      true
    )
    service.autoSignInSlack()
    await new Promise((r) => setTimeout(r, 30))
    expect(signIn.mock.calls.map((c) => c[0])).toEqual(['p-on'])
  })

  it('signing out of Slack keeps the account out of automatic sign-in', async () => {
    const { service, signIn, store } = setup([{ id: 'a', slack: { session: true } }], true)
    sessions['p-a'] = true
    await service.signOutSlack('a')
    expect(store.find('a')?.slack).toMatchObject({ session: false, keepSignedOut: true })
    service.autoSignInSlack()
    await new Promise((r) => setTimeout(r, 20))
    expect(signIn).not.toHaveBeenCalled()
    // Signing in by hand clears it.
    expect(await service.signInSlack('a')).toBe('signed-in')
    expect(store.find('a')?.slack.keepSignedOut).toBe(false)
  })

  it('waits before trying a failed account again', async () => {
    const { service, signIn } = setup([{ id: 'a' }], true)
    signIn.mockImplementation(async () => 'failed')
    service.autoSignInSlack()
    await new Promise((r) => setTimeout(r, 20))
    service.autoSignInSlack()
    await new Promise((r) => setTimeout(r, 20))
    expect(signIn).toHaveBeenCalledTimes(1)
  })
})
