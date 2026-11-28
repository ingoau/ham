import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Mail {
  uid: number
  envelope: { subject: string; to: { address: string }[] }
  internalDate: Date
}

const imap = vi.hoisted(() => {
  /** A stand-in for imapflow: one INBOX, mail from `mails`, and hooks to hold calls. */
  class FakeImap {
    static all: FakeImap[] = []
    static mails: Mail[] = []
    /** Resolves connect(); replace to hold it open. */
    static connectGate: () => Promise<void> = async () => {}
    static searchGate: () => Promise<void> = async () => {}
    private listeners = new Map<string, (() => void)[]>()
    closed = false
    loggedOut = false
    constructor(readonly opts: unknown) {
      FakeImap.all.push(this)
    }
    on(event: string, fn: () => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn])
      return this
    }
    emit(event: string) {
      for (const fn of this.listeners.get(event) ?? []) fn()
    }
    connect() {
      return FakeImap.connectGate()
    }
    async getMailboxLock() {
      return { release() {} }
    }
    async list() {
      return [{ path: 'INBOX', flags: new Set<string>() }]
    }
    async search() {
      await FakeImap.searchGate()
      return FakeImap.mails.map((m) => m.uid)
    }
    async *fetch(uids: number[]) {
      for (const m of FakeImap.mails) if (uids.includes(m.uid)) yield m
    }
    close() {
      if (this.closed) return
      this.closed = true
      this.emit('close')
    }
    async logout() {
      this.loggedOut = true
      this.close()
    }
  }
  return { FakeImap }
})

vi.mock('imapflow', () => ({ ImapFlow: imap.FakeImap }))
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const { Store } = await import('../src/main/store')
const { InboxService } = await import('../src/main/inbox')
const { removeTempDirs, settle, tempFile } = await import('./main-helpers')
const { FakeImap } = imap

const saved = { email: 'me@example.com', host: 'imap.example.com', port: 993, passwordEnc: Buffer.from('pw').toString('base64'), folders: ['INBOX'] }

function setup(linked = true) {
  const store = new Store(tempFile())
  if (linked) store.inbox = { ...saved }
  const onCode = vi.fn()
  const inbox = new InboxService(store, onCode, () => {}, false)
  services.push(inbox)
  return { store, inbox, onCode }
}

const services: { stop(): Promise<void> }[] = []
const live = () => FakeImap.all.filter((c) => !c.closed)
const codeMail = (uid: number, to: string, code = '123-456'): Mail => ({
  uid,
  envelope: { subject: `${code} is your Hack Club login code`, to: [{ address: to }] },
  internalDate: new Date()
})

beforeEach(() => {
  vi.useFakeTimers()
  FakeImap.all = []
  FakeImap.mails = []
  FakeImap.connectGate = async () => {}
  FakeImap.searchGate = async () => {}
})
afterEach(async () => {
  for (const s of services.splice(0)) await s.stop()
  vi.useRealTimers()
})
afterAll(removeTempDirs)

describe('checking for codes', () => {
  it('finds an expected account’s code and passes it on once', async () => {
    const { inbox, onCode } = setup()
    await inbox.start()
    expect(inbox.connected).toBe(true)
    FakeImap.mails = [codeMail(1, 'a@example.com')]
    inbox.expect('acct-a', 'a@example.com', Date.now() - 1000)
    await settle(50)
    expect(onCode).toHaveBeenCalledWith('acct-a', '123456', 'INBOX:1')
    inbox.markUsed('INBOX:1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(onCode).toHaveBeenCalledTimes(1)
  })

  it('polls while codes are expected', async () => {
    const { inbox, onCode } = setup()
    await inbox.start()
    inbox.expect('acct-a', 'a@example.com', Date.now() - 1000)
    await settle(50)
    expect(onCode).not.toHaveBeenCalled()
    FakeImap.mails = [codeMail(7, 'a@example.com', '999-000')]
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onCode).toHaveBeenCalledWith('acct-a', '999000', 'INBOX:7')
  })
})

describe('connection', () => {
  it('reconnects after the connection drops', async () => {
    const { inbox } = setup()
    await inbox.start()
    FakeImap.all[0].close()
    expect(inbox.status().state).toBe('connecting')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(FakeImap.all).toHaveLength(2)
    expect(inbox.connected).toBe(true)
  })

  it('backs off when connecting fails', async () => {
    const { inbox } = setup()
    FakeImap.connectGate = async () => {
      throw Object.assign(new Error('nope'), { code: 'ECONNREFUSED' })
    }
    await inbox.start()
    expect(inbox.status()).toMatchObject({ state: 'error', error: "Can't connect to that IMAP server." })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(FakeImap.all).toHaveLength(2)
    // Then twice as long.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(FakeImap.all).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(FakeImap.all).toHaveLength(3)
  })

  it('a check stuck on a dead connection resets it', async () => {
    const { inbox, onCode } = setup()
    await inbox.start()
    let stuck = true
    FakeImap.searchGate = () => (stuck ? new Promise(() => {}) : Promise.resolve())
    FakeImap.mails = [codeMail(1, 'a@example.com')]
    inbox.expect('acct-a', 'a@example.com', Date.now() - 1000)
    await settle(50)
    stuck = false
    await vi.advanceTimersByTimeAsync(65_000)
    expect(FakeImap.all[0].closed).toBe(true)
    // The reconnected client finds the code.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(FakeImap.all.length).toBeGreaterThan(1)
    expect(onCode).toHaveBeenCalledWith('acct-a', '123456', 'INBOX:1')
  })
})

describe('unlinking during a connect', () => {
  it('drops the late session instead of keeping it alive', async () => {
    const { store, inbox } = setup()
    let open = () => {}
    FakeImap.connectGate = () => new Promise<void>((r) => (open = r))
    const starting = inbox.start()
    await settle()
    expect(inbox.status().state).toBe('connecting')
    await inbox.unlink()
    open()
    await starting
    expect(store.inbox).toBeNull()
    expect(inbox.status().state).toBe('off')
    expect(live()).toHaveLength(0)
    expect(await inbox.findAddresses()).toMatchObject({ ok: false })
    // Nor does it come back later.
    await vi.advanceTimersByTimeAsync(130_000)
    expect(FakeImap.all).toHaveLength(1)
  })

  it('relinking while the first connect hangs keeps only the new session', async () => {
    const { inbox } = setup()
    let openFirst = () => {}
    FakeImap.connectGate = () => new Promise<void>((r) => (openFirst = r))
    const starting = inbox.start()
    await settle()
    FakeImap.connectGate = async () => {}
    // link() probes the new credentials with a client of its own first.
    expect(await inbox.link({ email: 'other@example.com', password: 'pw2', host: 'imap.other.com' })).toEqual({ ok: true })
    openFirst()
    await starting
    expect(inbox.status()).toMatchObject({ state: 'connected', email: 'other@example.com' })
    expect(live()).toHaveLength(1)
    expect((live()[0].opts as { host: string }).host).toBe('imap.other.com')
  })

  it('a connect that fails after unlinking doesn’t schedule a reconnect', async () => {
    const { inbox } = setup()
    let fail = () => {}
    FakeImap.connectGate = () => new Promise<void>((_, reject) => (fail = () => reject(new Error('late'))))
    const starting = inbox.start()
    await settle()
    await inbox.unlink()
    fail()
    await starting
    expect(inbox.status().state).toBe('off')
    await vi.advanceTimersByTimeAsync(130_000)
    expect(FakeImap.all).toHaveLength(1)
  })
})
