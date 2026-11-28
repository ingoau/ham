import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartOutcome, VerifyOutcome } from '../src/main/auth/backend'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
const { Store } = await import('../src/main/store')
const { AccountService, ATTEMPT_MS } = await import('../src/main/accounts')
const { NETWORK_RETRY } = await import('../src/main/signin-queue')
const { LOGIN_LIMIT } = await import('../src/main/limits')
const { account, removeTempDirs, settle, tempFile } = await import('./main-helpers')
type Backend = import('../src/main/auth/backend').AuthBackend
type InboxHooks = import('../src/main/accounts').InboxHooks
type StoredAccount = import('../src/main/store').StoredAccount

/** One fake Hack Club for every partition. */
function fakeBackend() {
  return {
    clearLocalData: vi.fn(async () => {}),
    startLogin: vi.fn(async (_email: string): Promise<StartOutcome> => ({ kind: 'code' })),
    attemptPath: () => '/login/abc',
    resumeAttempt: vi.fn(async (_path: string) => true),
    verifyEmailCode: vi.fn(async (): Promise<VerifyOutcome> => ({ kind: 'done' })),
    verifySecondFactor: vi.fn(async (): Promise<VerifyOutcome> => ({ kind: 'done' })),
    readProfile: vi.fn(async () => ({ kind: 'ok' as const, profile: { firstName: 'Ada', lastName: 'L', phone: '', hasLegalName: false } })),
    sessionExpiry: async () => null,
    hasSlackSession: async () => false,
    slackId: async () => null,
    readSlack: async () => ({ kind: 'signed-out' as const }),
    signOut: vi.fn(async () => true)
  }
}

function setup(accounts: StoredAccount[] = [], inbox?: Partial<InboxHooks>) {
  const store = new Store(tempFile())
  for (const a of accounts) store.upsert(a)
  const be = fakeBackend()
  const toast = vi.fn()
  const service = new AccountService(store, () => be as unknown as Backend, () => {}, toast)
  const hooks = { connected: false, expect: vi.fn(), forget: vi.fn(), markUsed: vi.fn(), ...inbox }
  service.setInbox(hooks)
  services.push(service)
  return { store, be, service, toast, inbox: hooks }
}

const services: { stop(): void }[] = []

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const s of services.splice(0)) s.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
afterAll(removeTempDirs)

const deferred = <T>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('starting sign-ins', () => {
  it('sends an added account’s email and waits for the code', async () => {
    const { store, be, service } = setup()
    const { added } = service.add(['Ada@Example.com', 'not an email', 'ada@example.com'])
    expect(added).toHaveLength(1)
    await settle()
    expect(be.clearLocalData).toHaveBeenCalledTimes(1)
    expect(be.startLogin).toHaveBeenCalledWith('ada@example.com')
    const a = store.find(added[0])!
    expect(a.status).toBe('waiting')
    expect(a.attemptPath).toBe('/login/abc')
    expect(a.pending?.startedAt).toBeTruthy()
    expect(store.loginLog).toHaveLength(1)
  })

  it('marks accounts Hack Club doesn’t know, locked ones and odd replies as failed', async () => {
    const { store, be, service } = setup()
    be.startLogin
      .mockResolvedValueOnce({ kind: 'no-account' })
      .mockResolvedValueOnce({ kind: 'locked', message: 'Locked.' })
      .mockResolvedValueOnce({ kind: 'unexpected', message: 'Odd.' })
    const { added } = service.add(['a@example.com', 'b@example.com', 'c@example.com'])
    await settle()
    expect(added.map((id) => [store.find(id)!.status, store.find(id)!.pending?.message])).toEqual([
      ['failed', 'no-account'],
      ['failed', 'Locked.'],
      ['failed', 'Odd.']
    ])
  })

  it('backs off for a full window when Hack Club rate limits', async () => {
    const { store, be, service } = setup()
    be.startLogin.mockResolvedValueOnce({ kind: 'rate-limited' })
    await service.resume()
    const [id] = service.add(['a@example.com']).added
    await settle()
    expect(store.find(id)!.status).toBe('queued')
    expect(store.loginLog).toHaveLength(LOGIN_LIMIT)
    await vi.advanceTimersByTimeAsync(1000)
    const startsAt = Date.parse(store.find(id)!.pending!.startsAt!)
    expect(startsAt - Date.now()).toBeGreaterThan(4 * 60 * 1000)
    expect(be.startLogin).toHaveBeenCalledTimes(1)
  })

  it('queues past the client-side limit and shows when each starts', async () => {
    const { store, be, service } = setup()
    be.startLogin.mockImplementation(() => new Promise(() => {}))
    const emails = Array.from({ length: LOGIN_LIMIT + 2 }, (_, i) => `u${i}@example.com`)
    const { added } = service.add(emails)
    await settle()
    expect(be.startLogin).toHaveBeenCalledTimes(LOGIN_LIMIT)
    const last = store.find(added[added.length - 1])!
    expect(last.status).toBe('queued')
    expect(last.pending?.startsAt).toBeTruthy()
  })
})

describe('network errors', () => {
  it('retry after 5 s, 15 s, then every 60 s, without spending slots on requests that never left', async () => {
    const { store, be, service } = setup()
    const offline: StartOutcome = { kind: 'network', message: 'Offline', sent: false }
    be.startLogin.mockResolvedValue(offline)
    await service.resume()
    const [id] = service.add(['a@example.com']).added
    await settle()
    const a = () => store.find(id)!
    expect(a().status).toBe('queued')
    expect(store.loginLog).toHaveLength(0)
    expect(Date.parse(a().pending!.startsAt!) - Date.now()).toBe(NETWORK_RETRY[0])

    for (const wait of [NETWORK_RETRY[0], NETWORK_RETRY[1], NETWORK_RETRY[2], NETWORK_RETRY[2]]) {
      const calls = be.startLogin.mock.calls.length
      await vi.advanceTimersByTimeAsync(wait - 1000)
      expect(be.startLogin.mock.calls.length).toBe(calls)
      await vi.advanceTimersByTimeAsync(1000)
      expect(be.startLogin.mock.calls.length).toBe(calls + 1)
    }
    expect(a().status).toBe('queued')
    expect(store.loginLog).toHaveLength(0)

    be.startLogin.mockResolvedValue({ kind: 'code' })
    await vi.advanceTimersByTimeAsync(NETWORK_RETRY[2])
    expect(a().status).toBe('waiting')
  })

  it('keep the slot when the request may have reached Hack Club', async () => {
    const { store, be, service } = setup()
    be.startLogin.mockResolvedValueOnce({ kind: 'network', message: 'Timed out', sent: true })
    service.add(['a@example.com'])
    await settle()
    expect(store.loginLog).toHaveLength(1)
  })

  it('a restart skips the wait', async () => {
    const { store, be, service } = setup()
    be.startLogin.mockResolvedValueOnce({ kind: 'network', message: 'Offline', sent: false })
    const [id] = service.add(['a@example.com']).added
    await settle()
    service.restart(id)
    await settle()
    expect(be.startLogin).toHaveBeenCalledTimes(2)
    expect(store.find(id)!.status).toBe('waiting')
  })
})

describe('a start that throws', () => {
  it('fails the account and gives the slot back', async () => {
    const { store, be, service } = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    be.clearLocalData.mockRejectedValueOnce(new Error('disk'))
    const [id] = service.add(['a@example.com']).added
    await settle()
    expect(store.find(id)!.status).toBe('failed')
    expect(store.find(id)!.pending?.message).toBeTruthy()
    expect(store.loginLog).toHaveLength(0)
    expect(be.startLogin).not.toHaveBeenCalled()
  })
})

describe('removing during a sign-in', () => {
  it('drops a new account even if its email goes out afterwards', async () => {
    const { store, be, service } = setup()
    const start = deferred<StartOutcome>()
    be.startLogin.mockReturnValueOnce(start.promise)
    const [id] = service.add(['a@example.com']).added
    await settle()
    expect(store.find(id)!.status).toBe('sending')
    expect(await service.remove(id)).toEqual({ serverSignedOut: true, removed: true })
    start.resolve({ kind: 'code' })
    await settle()
    expect(store.find(id)).toBeUndefined()
  })

  it('cancels an existing account’s sign-in back to signed out', async () => {
    const { store, be, service } = setup([account('a', { status: 'signed-out' })])
    const start = deferred<StartOutcome>()
    be.startLogin.mockReturnValueOnce(start.promise)
    service.signInAgain(['a'])
    await settle()
    expect(store.find('a')!.status).toBe('sending')
    expect(await service.remove('a')).toEqual({ serverSignedOut: true, removed: false })
    start.resolve({ kind: 'code' })
    await settle()
    expect(store.find('a')!.status).toBe('signed-out')
    expect(be.signOut).not.toHaveBeenCalled()
  })
})

describe('attempts', () => {
  it('expire after 15 minutes without an inbox', async () => {
    const { store, service } = setup()
    await service.resume()
    const [id] = service.add(['a@example.com']).added
    await settle()
    expect(store.find(id)!.status).toBe('waiting')
    await vi.advanceTimersByTimeAsync(ATTEMPT_MS)
    expect(store.find(id)!.pending?.expired).toBe(true)
    expect(store.find(id)!.status).toBe('waiting')
  })

  it('start again by themselves with an inbox, keeping the second factor', async () => {
    const { store, be, service, inbox } = setup([], { connected: true })
    await service.resume()
    const [id] = service.add(['a@example.com']).added
    await settle()
    expect(inbox.expect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(ATTEMPT_MS + 1000)
    expect(be.startLogin).toHaveBeenCalledTimes(2)
    expect(store.find(id)!.status).toBe('waiting')
    expect(inbox.expect).toHaveBeenCalledTimes(2)
  })
})

describe('resuming after a restart', () => {
  it('requeues an interrupted send, picks up live attempts and starts dead ones again (with an inbox)', async () => {
    const now = new Date().toISOString()
    const pending = { startedAt: now, startsAt: null, autoCode: null, second: 'totp' as const, message: null, expired: false }
    const { store, be, service, inbox } = setup(
      [
        account('sending', { status: 'sending', fresh: true }),
        account('live', { status: 'waiting', attemptPath: '/login/live', pending }),
        account('dead', { status: 'waiting', attemptPath: '/login/dead', pending }),
        account('old', { status: 'needs2fa', attemptPath: '/login/old', pending: { ...pending, startedAt: new Date(Date.now() - ATTEMPT_MS).toISOString() } })
      ],
      { connected: true }
    )
    be.resumeAttempt.mockImplementation(async (path: string) => path === '/login/live')
    await service.resume()
    await settle()
    expect(store.find('sending')!.status).toBe('waiting')
    expect(be.startLogin).toHaveBeenCalledWith('sending@example.com')
    expect(store.find('live')!.pending?.expired).toBe(false)
    expect(inbox.expect).toHaveBeenCalledWith('live', 'live@example.com', Date.parse(now))
    expect(be.startLogin.mock.calls.map((c) => c[0]).sort()).toEqual(['dead@example.com', 'old@example.com', 'sending@example.com'])
    expect(be.startLogin).not.toHaveBeenCalledWith('live@example.com')
    // An expired attempt isn't even asked about.
    expect(be.resumeAttempt).not.toHaveBeenCalledWith('/login/old')
  })

  it('marks dead attempts expired without an inbox', async () => {
    const pending = { startedAt: new Date().toISOString(), startsAt: null, autoCode: null, second: 'totp' as const, message: null, expired: false }
    const { store, be, service } = setup([account('dead', { status: 'waiting', attemptPath: '/login/dead', pending })])
    be.resumeAttempt.mockResolvedValue(false)
    await service.resume()
    await settle()
    expect(store.find('dead')!.pending?.expired).toBe(true)
    expect(be.startLogin).not.toHaveBeenCalled()
  })
})

describe('codes', () => {
  it('signs in with the email code', async () => {
    const { store, service, toast } = setup()
    const [id] = service.add(['a@example.com']).added
    await settle()
    expect(await service.submitEmailCode(id, '123456')).toEqual({ ok: true })
    expect(store.find(id)).toMatchObject({ status: 'signed-in', firstName: 'Ada', pending: null, fresh: false })
    expect(toast).toHaveBeenCalledWith('Added a@example.com', 'success')
  })

  it('asks for the second factor, then signs in', async () => {
    const { store, be, service } = setup()
    be.verifyEmailCode.mockResolvedValueOnce({ kind: 'totp' })
    const [id] = service.add(['a@example.com']).added
    await settle()
    await service.submitEmailCode(id, '123456')
    expect(store.find(id)!.status).toBe('needs2fa')
    expect(await service.submitSecondFactor(id, 'totp', '654321')).toEqual({ ok: true })
    expect(store.find(id)!.status).toBe('signed-in')
  })

  it('an inbox code that hits a network error is submitted again, and the slot given back', async () => {
    const { store, be, service, inbox } = setup([], { connected: true })
    be.verifyEmailCode.mockResolvedValueOnce({ kind: 'network', message: 'Offline', sent: false })
    const [id] = service.add(['a@example.com']).added
    await settle()
    service.onInboxCode(id, '111222', 'INBOX:1')
    await vi.advanceTimersByTimeAsync(700)
    expect(inbox.markUsed).toHaveBeenCalledWith('INBOX:1')
    expect(be.verifyEmailCode).toHaveBeenCalledTimes(1)
    expect(store.checkLog).toHaveLength(0)
    expect(store.find(id)!.status).toBe('waiting')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(be.verifyEmailCode).toHaveBeenCalledTimes(2)
    expect(store.find(id)!.status).toBe('signed-in')
  })

  it('a typed code that hits a network error says so', async () => {
    const { store, be, service } = setup()
    be.verifyEmailCode.mockResolvedValueOnce({ kind: 'network', message: 'Offline', sent: true })
    const [id] = service.add(['a@example.com']).added
    await settle()
    expect(await service.submitEmailCode(id, '123456')).toEqual({ ok: false, message: 'Offline' })
    expect(store.checkLog).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(be.verifyEmailCode).toHaveBeenCalledTimes(1)
  })
})
