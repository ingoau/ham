import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SlackInfo } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
const { Store } = await import('../src/main/store')
const { AccountService } = await import('../src/main/accounts')
type Backend = import('../src/main/auth/backend').AuthBackend
type SlackSignIn = import('../src/main/accounts').SlackSignIn

/** Slack sessions by partition, shared by the fake backends. */
let sessions: Record<string, boolean> = {}
/** Whether Hack Club still has each partition signed in (default yes). */
let hca: Record<string, boolean> = {}

function fakeBackend(partition: string): Backend {
  return {
    hasSlackSession: async () => sessions[partition] === true,
    readProfile: async () => (hca[partition] === false ? { kind: 'signed-out' } : { kind: 'ok', profile: {} }),
    readSlack: async () => (sessions[partition] ? { kind: 'ok', userId: 'U1', profile: {}, fields: [], users: {} } : { kind: 'signed-out' }),
    signOutSlack: async () => {
      sessions[partition] = false
    }
  } as unknown as Backend
}

function setup(accounts: { id: string; status?: 'signed-in' | 'signed-out'; slack?: Partial<SlackInfo> }[], autoSlack = false) {
  sessions = {}
  hca = {}
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
  const signIn = vi.fn<SlackSignIn>(async (partition) => {
    running++
    most = Math.max(most, running)
    await new Promise((r) => setTimeout(r, 5))
    running--
    sessions[partition] = true
    return 'signed-in'
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

describe('Slack sign-in races', () => {
  it('drops a sign-in that finishes after signing out of Slack', async () => {
    const { service, signIn, store } = setup([{ id: 'a' }])
    let release = () => {}
    signIn.mockImplementationOnce(async (partition) => {
      await new Promise<void>((r) => (release = r))
      sessions[partition] = true
      return 'signed-in'
    })
    const pending = service.signInSlack('a')
    await new Promise((r) => setTimeout(r, 5))
    const out = service.signOutSlack('a')
    release()
    expect(await pending).toBe('failed')
    await out
    expect(store.find('a')?.slack).toMatchObject({ session: false, keepSignedOut: true })
  })

  it('only marks the account signed out when Hack Club agrees', async () => {
    const { service, signIn, store } = setup([{ id: 'a' }, { id: 'b' }])
    signIn.mockImplementation(async () => 'signed-out')
    hca['p-b'] = false
    expect(await service.signInSlack('a')).toBe('failed')
    expect(store.find('a')?.status).toBe('signed-in')
    expect(await service.signInSlack('b')).toBe('signed-out')
    expect(store.find('b')?.status).toBe('signed-out')
  })

  it('a manual sign-in joining a skipped automatic one tries again', async () => {
    const { service, signIn, store } = setup([{ id: 'a' }], true)
    const releases: (() => void)[] = []
    // Hold the three slots so the automatic run waits for a turn.
    const hold = vi.fn<() => Promise<'failed'>>(() => new Promise((r) => releases.push(() => r('failed'))))
    signIn.mockImplementationOnce(hold).mockImplementationOnce(hold).mockImplementationOnce(hold)
    for (const id of ['x', 'y', 'z']) {
      store.upsert({ ...store.find('a')!, id, partition: `p-${id}`, slack: { linked: false, session: false, profile: {} } })
    }
    const holders = ['x', 'y', 'z'].map((id) => service.signInSlack(id))
    await new Promise((r) => setTimeout(r, 5))
    service.autoSignInSlack(['a'])
    service.setAutoSlack(false)
    const manual = service.signInSlack('a')
    releases.forEach((r) => r())
    await Promise.all(holders)
    expect(await manual).toBe('signed-in')
  })
})

describe('Slack sign-in after sign-out', () => {
  it('a manual sign-in that joined an automatic one stays out after signing out of Slack', async () => {
    const { service, signIn, store } = setup([{ id: 'a' }], true)
    let release = () => {}
    signIn.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r))
      return 'failed'
    })
    service.autoSignInSlack(['a'])
    await new Promise((r) => setTimeout(r, 5))
    const manual = service.signInSlack('a')
    const out = service.signOutSlack('a')
    release()
    expect(await manual).toBe('failed')
    await out
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(store.find('a')?.slack).toMatchObject({ session: false, keepSignedOut: true })
  })

  it('a new sign-in after signing out of Slack does not join the dropped one', async () => {
    const { service, signIn } = setup([{ id: 'a' }])
    let release = () => {}
    signIn.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r))
      return 'failed'
    })
    const first = service.signInSlack('a')
    await new Promise((r) => setTimeout(r, 5))
    await service.signOutSlack('a')
    const second = service.signInSlack('a')
    release()
    expect(await first).toBe('failed')
    expect(await second).toBe('signed-in')
  })

  it('counts a "failed" sign-in that left a Slack session as signed in', async () => {
    const { service, signIn } = setup([{ id: 'a' }])
    signIn.mockImplementationOnce(async (partition) => {
      sessions[partition] = true
      return 'failed'
    })
    expect(await service.signInSlack('a')).toBe('signed-in')
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
