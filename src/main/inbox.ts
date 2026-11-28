// The linked inbox: an IMAP connection (imapflow, TLS only) that fills in
// Hack Club login codes and finds past Hack Club Auth recipients. Mailboxes
// are only ever opened read-only (EXAMINE), so HAM never marks mail as read
// or changes anything. The app password is stored with safeStorage.
import { safeStorage } from 'electron'
import { ImapFlow, type ListResponse } from 'imapflow'
import type { FindResult, ImapLinkInput, InboxStatus } from '@shared/types'
import {
  FoundSet,
  HCA_SENDER,
  SLACK_SEARCH,
  codeFromSubject,
  matchCodes,
  parseHostPort,
  recipientsOf,
  type CodeMail,
  type Expectation
} from './inbox-match'
import type { InboxSettings, Store } from './store'

const POLL_MS = 5_000
const DEBUG = process.env.HAM_DEBUG_INBOX === '1'
const debug = (...args: unknown[]) => {
  if (DEBUG) console.log('[inbox]', ...args)
}
const SKIP_SPECIAL = new Set(['\\Trash', '\\Drafts', '\\Sent', '\\All', '\\Flagged'])

type CodeListener = (accountId: string, code: string, messageKey: string) => void

function friendly(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; code?: string; message?: string; responseText?: string }
  if (e?.authenticationFailed) return 'The email address or app password was rejected.'
  if (e?.code === 'ENOTFOUND') return "Can't find that IMAP server."
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT') return "Can't connect to that IMAP server."
  return e?.responseText || e?.message || 'Unknown IMAP error'
}

export class InboxService {
  private client: ImapFlow | null = null
  private state: InboxStatus = { state: 'off', email: null, host: null, error: null }
  private readonly expectations = new Map<string, Expectation>()
  private readonly used = new Set<string>()
  private pollTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  /** Bumped by every connect and disconnect, so a connect that finishes late drops its client. */
  private gen = 0
  private checking = false
  /** Bumped by every check, so one the watchdog gave up on can't clear a newer one's flag. */
  private checkRun = 0
  private checkStartedAt = 0
  private recheck = false
  private retryMs = 5_000
  private primary = 'INBOX'

  constructor(
    private readonly store: Store,
    private readonly onCode: CodeListener,
    private readonly onStatus: () => void,
    private readonly mock: boolean
  ) {}

  status(): InboxStatus {
    return this.state
  }

  get connected(): boolean {
    return this.state.state === 'connected'
  }

  private setState(next: Partial<InboxStatus>) {
    this.state = { ...this.state, ...next }
    this.onStatus()
  }

  // --- linking -------------------------------------------------------------

  async start() {
    const saved = this.store.inbox
    if (!saved) return
    this.setState({ state: 'connecting', email: saved.email, host: `${saved.host}:${saved.port}`, error: null })
    await this.connect(saved)
  }

  async link(input: ImapLinkInput): Promise<{ ok: true } | { ok: false; message: string }> {
    const hp = parseHostPort(input.host)
    if (!hp) return { ok: false, message: 'Enter a server like imap.example.com:993' }
    if (!this.mock && !safeStorage.isEncryptionAvailable()) {
      return { ok: false, message: "This computer can't encrypt the password, so HAM won't store it." }
    }
    const email = input.email.trim().toLowerCase()
    if (this.mock) {
      if (input.password === 'wrong') return { ok: false, message: 'The email address or app password was rejected.' }
    } else {
      // Test the credentials before saving anything.
      const probe = this.makeClient(hp.host, hp.port, email, input.password)
      try {
        await probe.connect()
        const lock = await probe.getMailboxLock('INBOX', { readOnly: true })
        lock.release()
        await probe.logout()
      } catch (err) {
        probe.close()
        return { ok: false, message: friendly(err) }
      }
    }
    const settings: InboxSettings = {
      email,
      host: hp.host,
      port: hp.port,
      passwordEnc: this.mock ? '' : safeStorage.encryptString(input.password).toString('base64'),
      folders: []
    }
    await this.disconnect()
    this.store.inbox = settings
    this.setState({ state: 'connecting', email, host: `${hp.host}:${hp.port}`, error: null })
    await this.connect(settings)
    return { ok: true }
  }

  async unlink() {
    await this.disconnect()
    this.store.inbox = null
    this.setState({ state: 'off', email: null, host: null, error: null })
  }

  private makeClient(host: string, port: number, user: string, pass: string): ImapFlow {
    return new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false, emitLogs: false })
  }

  private async connect(settings: InboxSettings) {
    const gen = ++this.gen
    const stale = () => gen !== this.gen
    if (this.mock) {
      this.setState({ state: 'connected', error: null })
      this.schedulePoll()
      return
    }
    let password: string
    try {
      password = safeStorage.decryptString(Buffer.from(settings.passwordEnc, 'base64'))
    } catch {
      this.setState({ state: 'error', error: "Couldn't read the saved password. Link the inbox again." })
      return
    }
    const client = this.makeClient(settings.host, settings.port, settings.email, password)
    client.on('error', () => {})
    client.on('close', () => {
      if (this.client !== client) return
      this.client = null
      if (this.store.inbox) {
        this.setState({ state: 'connecting' })
        this.scheduleReconnect()
      }
    })
    // New mail in the IDLEd mailbox: look for codes straight away.
    client.on('exists', () => {
      if (this.client === client) void this.check()
    })
    try {
      await client.connect()
      // Unlinked, relinked or reconnected meanwhile: this session isn't wanted.
      if (stale()) {
        client.close()
        return
      }
      this.client = client
      this.retryMs = 5_000
      this.pickPrimary()
      this.setState({ state: 'connected', error: null })
      if (settings.folders.length === 0) void this.discoverFolders(client)
      await this.idleOnPrimary(client)
      if (stale()) return
      this.schedulePoll()
      void this.check()
    } catch (err) {
      if (this.client === client) this.client = null
      client.close()
      if (stale()) return
      this.setState({ state: 'error', error: friendly(err) })
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.store.inbox) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      const saved = this.store.inbox
      if (saved && !this.client) void this.connect(saved)
    }, this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, 120_000)
  }

  private async disconnect() {
    this.gen++
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.pollTimer = null
    this.reconnectTimer = null
    const c = this.client
    this.client = null
    if (c) {
      try {
        await c.logout()
      } catch {
        c.close()
      }
    }
  }

  // --- folders -------------------------------------------------------------

  private async folders(client: ImapFlow): Promise<ListResponse[]> {
    const all = (await client.list()) ?? []
    return all.filter((f) => !f.flags?.has('\\Noselect') && !(f.specialUse && SKIP_SPECIAL.has(f.specialUse)))
  }

  /** Mailboxes to watch: INBOX, Junk, and any folder Hack Club Auth mail has landed in. */
  private async candidates(client: ImapFlow): Promise<string[]> {
    const saved = this.store.inbox?.folders ?? []
    const list = await this.folders(client)
    const junk = list.filter((f) => f.specialUse === '\\Junk').map((f) => f.path)
    const exists = new Set(list.map((f) => f.path))
    const paths = [...new Set(['INBOX', ...saved, ...junk])].filter((p) => p === 'INBOX' || exists.has(p))
    // Check the primary (IDLE) mailbox last so it stays selected afterwards.
    return [...paths.filter((p) => p !== this.primary), this.primary]
  }

  private pickPrimary() {
    const saved = this.store.inbox?.folders ?? []
    this.primary = saved[0] ?? 'INBOX'
  }

  private async idleOnPrimary(client: ImapFlow) {
    const lock = await client.getMailboxLock(this.primary, { readOnly: true })
    lock.release() // stays selected; imapflow IDLEs on it while nothing else runs
  }

  private rememberFolder(path: string) {
    const inbox = this.store.inbox
    if (!inbox) return
    if (inbox.folders[0] === path) return
    // Most recent hit first: it becomes the IDLE mailbox.
    inbox.folders = [path, ...inbox.folders.filter((f) => f !== path)].slice(0, 8)
    this.store.inbox = inbox
    this.primary = path
  }

  private async searchFolder(client: ImapFlow, path: string, since?: Date): Promise<{ uids: number[] }> {
    const lock = await client.getMailboxLock(path, { readOnly: true })
    try {
      const query = since ? { from: HCA_SENDER, since } : { from: HCA_SENDER }
      const uids = (await client.search(query, { uid: true })) || []
      return { uids }
    } finally {
      lock.release()
    }
  }

  private async discoverFolders(client: ImapFlow) {
    try {
      const since = new Date(Date.now() - 90 * 86_400_000)
      for (const f of await this.folders(client)) {
        const { uids } = await this.searchFolder(client, f.path, since)
        if (this.client !== client) return
        if (uids.length > 0 && f.path !== 'INBOX') this.rememberFolder(f.path)
      }
      await this.idleOnPrimary(client)
    } catch {
      // best effort
    }
  }

  // --- codes ---------------------------------------------------------------

  expect(accountId: string, email: string, since: number) {
    this.expectations.set(accountId, { accountId, email, since })
    this.schedulePoll()
    if (this.mock && this.connected) {
      setTimeout(() => {
        const exp = this.expectations.get(accountId)
        if (exp && exp.since === since) this.onCode(accountId, '684629', `mock:${accountId}:${since}`)
      }, 1600 + Math.floor(Math.random() * 1200))
      return
    }
    void this.check()
  }

  forget(accountId: string) {
    this.expectations.delete(accountId)
  }

  markUsed(key: string) {
    this.used.add(key)
  }

  private schedulePoll() {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      // Watchdog: a check stuck on a dead connection resets it, and the
      // connection's close handler reconnects.
      if (this.checking && Date.now() - this.checkStartedAt > 60_000) {
        debug('check stuck; reconnecting')
        this.checking = false
        this.checkRun++
        this.client?.close()
        return
      }
      if (this.expectations.size > 0) void this.check()
    }, POLL_MS)
  }

  private async check() {
    const client = this.client
    if (this.mock || !client || this.expectations.size === 0) return
    if (this.checking) {
      this.recheck = true
      return
    }
    this.checking = true
    const run = ++this.checkRun
    this.checkStartedAt = Date.now()
    try {
      const exps = [...this.expectations.values()]
      debug('check', exps.length, 'expectations')
      const earliest = Math.min(...exps.map((e) => e.since))
      // IMAP SEARCH SINCE is by date, so look back a day and filter precisely below.
      const since = new Date(earliest - 86_400_000)
      const mails: CodeMail[] = []
      const paths = await this.candidates(client)
      debug('folders', paths)
      for (const path of paths) {
        const lock = await client.getMailboxLock(path, { readOnly: true })
        try {
          const uids = (await client.search({ from: HCA_SENDER, since }, { uid: true })) || []
          debug(path, uids.length, 'HCA messages since', since.toISOString())
          const fresh = uids.filter((u) => !this.used.has(`${path}:${u}`)).slice(-50)
          if (fresh.length === 0) continue
          for await (const msg of client.fetch(
            fresh,
            { uid: true, envelope: true, internalDate: true, headers: ['delivered-to', 'x-original-to'] },
            { uid: true }
          )) {
            const code = codeFromSubject(msg.envelope?.subject)
            if (!code) continue
            const at = msg.internalDate ? new Date(msg.internalDate).getTime() : 0
            if (at < earliest - 120_000) continue
            mails.push({
              key: `${path}:${msg.uid}`,
              code,
              recipients: recipientsOf(msg.envelope, msg.headers?.toString('utf8') ?? ''),
              receivedAt: at
            })
          }
        } finally {
          lock.release()
        }
      }
      debug('mails', mails.length, mails.map((m) => [m.key, m.receivedAt]))
      // The connection was dropped or replaced meanwhile (perhaps by another inbox).
      if (this.client !== client) return
      for (const hit of matchCodes(mails, exps, this.used)) {
        const path = hit.key.slice(0, hit.key.lastIndexOf(':'))
        if (path !== 'INBOX') this.rememberFolder(path)
        this.expectations.delete(hit.accountId)
        this.onCode(hit.accountId, hit.code, hit.key)
      }
    } catch (err) {
      // A dropped connection reconnects on its own; try again next poll.
      debug('check failed', err)
    } finally {
      if (run === this.checkRun) {
        this.checking = false
        if (this.recheck) {
          this.recheck = false
          void this.check()
        }
      }
    }
  }

  // --- finding accounts ----------------------------------------------------

  async findAddresses(): Promise<FindResult> {
    if (this.mock) {
      await new Promise((r) => setTimeout(r, 900))
      const found = new FoundSet()
      found.add(Array.from({ length: 8 }, (_, i) => `hc-alt${i + 1}@example.com`).concat(['fiona.leads@example.org', '2fa.robotics@example.com']), 'hca')
      found.add(['fiona.leads@example.org', 'orpheus.slack@example.com', 'no.account@example.com'], 'slack')
      return { ok: true, addresses: found.list() }
    }
    const client = this.client
    if (!client) return { ok: false, message: 'The inbox isn’t connected right now.' }
    try {
      const found = new FoundSet()
      for (const f of await this.folders(client)) {
        const lock = await client.getMailboxLock(f.path, { readOnly: true })
        try {
          // Hack Club Auth mail, then Hack Club Slack mail. Only envelopes and two headers are fetched.
          for (const [source, query] of [
            ['hca', { from: HCA_SENDER }],
            ['slack', SLACK_SEARCH]
          ] as const) {
            const uids = (await client.search(query, { uid: true })) || []
            if (uids.length === 0) continue
            if (source === 'hca' && f.path !== 'INBOX' && this.client === client) this.rememberFolder(f.path)
            for await (const msg of client.fetch(
              uids.slice(-2000),
              { uid: true, envelope: true, headers: ['delivered-to', 'x-original-to'] },
              { uid: true }
            )) {
              found.add(recipientsOf(msg.envelope, msg.headers?.toString('utf8') ?? ''), source)
            }
          }
        } finally {
          lock.release()
        }
      }
      if (this.client === client) await this.idleOnPrimary(client)
      return { ok: true, addresses: found.list() }
    } catch (err) {
      return { ok: false, message: friendly(err) }
    }
  }

  async stop() {
    await this.disconnect()
  }
}
