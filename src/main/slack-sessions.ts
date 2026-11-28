// Signing accounts in to and out of Slack. Sign-ins run in hidden windows (see
// slack.ts), a few at a time; automatic ones skip accounts signed out of Slack
// in HAM and wait a while after a failure.
import type { SlackSignInResult } from '@shared/types'
import type { AccountRecords } from './account-records'

/** Hidden Slack sign-ins running at once. */
const SLACK_SIGN_IN_LIMIT = 3
/** How long automatic Slack sign-in waits before trying an account again after it failed. */
const AUTO_SLACK_RETRY = 30 * 60 * 1000

/** Signs a partition in to Slack in a hidden window (see slack.ts). */
export type SlackSignIn = (partition: string) => Promise<'signed-in' | 'signed-out' | 'failed'>
/** A sign-in's result, or 'skipped': an automatic one found nothing to do. */
type SlackRun = SlackSignInResult | 'skipped'

export class SlackSessions {
  private hook: SlackSignIn | null = null
  private readonly signingIn = new Map<string, Promise<SlackRun>>()
  private readonly autoFailed = new Map<string, number>()
  /** Bumped by Slack sign-out and removal, so a sign-in that started before either drops its result. */
  private readonly gens = new Map<string, number>()
  private slots = 0
  private readonly waiters: (() => void)[] = []

  constructor(
    private readonly records: AccountRecords,
    /** Read the Slack profile again; `fresh` drops the cached token first. */
    private readonly refreshSlack: (id: string, fresh: boolean) => Promise<void>
  ) {}

  private get store() {
    return this.records.store
  }

  setSignIn(fn: SlackSignIn) {
    this.hook = fn
  }

  private gen(id: string): number {
    return this.gens.get(id) ?? 0
  }

  /** Sign an account in to Slack in a hidden window. At most a few run at once; the rest wait their turn. */
  async signIn(id: string): Promise<SlackSignInResult> {
    // This may join an automatic run, which can skip; then try again by hand,
    // unless it skipped because the account was signed out of Slack or removed.
    const gen = this.gen(id)
    const joined = await this.start(id, false)
    if (joined !== 'skipped') return joined
    if (this.gen(id) !== gen) return 'failed'
    const r = await this.start(id, false)
    return r === 'skipped' ? 'failed' : r
  }

  private start(id: string, auto: boolean): Promise<SlackRun> {
    const running = this.signingIn.get(id)
    if (running) return running
    const run: Promise<SlackRun> = this.run(id, auto).finally(() => {
      if (this.signingIn.get(id) === run) this.signingIn.delete(id)
    })
    this.signingIn.set(id, run)
    return run
  }

  /** Make any sign-in for the account drop its result, and let a new one start rather than join it. */
  private bump(id: string) {
    this.gens.set(id, this.gen(id) + 1)
    this.signingIn.delete(id)
  }

  /** The account is being removed: drop its sign-ins and failure record. */
  forget(id: string) {
    this.bump(id)
    this.autoFailed.delete(id)
  }

  /** Drop every Slack sign-in, running or waiting for a turn (the main window closed). */
  cancelAll() {
    for (const id of [...this.signingIn.keys()]) this.bump(id)
  }

  private async run(id: string, auto: boolean): Promise<SlackRun> {
    const gen = this.gen(id)
    // Signed out of Slack or removed since this started: leave it be.
    const stale = () => this.gen(id) !== gen
    const gone: SlackRun = auto ? 'skipped' : 'failed'
    const first = this.store.find(id)
    if (!first || first.status !== 'signed-in') return 'signed-out'
    if (await this.records.backend(first.partition).hasSlackSession()) {
      if (stale()) return gone
      this.records.setSlack(id, { session: true, keepSignedOut: false })
      return 'already'
    }
    if (!this.hook) return 'failed'
    await this.takeSlot()
    let result: 'signed-in' | 'signed-out' | 'failed'
    try {
      // Things may have changed while it waited for a turn.
      if (stale()) return gone
      const a = this.store.find(id)
      if (!a || a.status !== 'signed-in') return 'signed-out'
      if (auto && (!this.store.autoSlack || a.slack.keepSignedOut || a.slack.session)) return 'skipped'
      result = await this.hook(a.partition)
    } finally {
      this.releaseSlot()
    }
    if (stale()) return gone
    const a = this.store.find(id)
    if (!a) return gone
    const backend = this.records.backend(a.partition)
    // The cookie is what counts: a sign-in cut short after Slack set it still worked.
    const hasSession = await backend.hasSlackSession()
    if (result === 'signed-in' && !hasSession) result = 'failed'
    else if (result === 'failed' && hasSession) result = 'signed-in'
    // Only believe "signed out" if Hack Club says so too.
    if (result === 'signed-out' && (await backend.readProfile()).kind !== 'signed-out') result = 'failed'
    if (stale()) return gone
    if (result === 'signed-in') {
      this.records.setSlack(id, { linked: true, session: true, keepSignedOut: false })
      void this.refreshSlack(id, true)
    } else if (result === 'signed-out') this.records.markSignedOut(id)
    return result
  }

  private async takeSlot() {
    while (this.slots >= SLACK_SIGN_IN_LIMIT) await new Promise<void>((r) => this.waiters.push(r))
    this.slots++
  }

  private releaseSlot() {
    this.slots--
    this.waiters.shift()?.()
  }

  /**
   * With automatic Slack sign-in on, sign accounts that are on Slack but not
   * signed in to it in to Slack (all of them, or just `ids`). Never makes a
   * Slack account, and leaves alone accounts signed out of Slack in HAM.
   */
  autoSignIn(ids?: string[]) {
    if (!this.store.autoSlack || !this.hook) return
    const now = Date.now()
    for (const a of this.store.accounts) {
      if (ids && !ids.includes(a.id)) continue
      if (a.status !== 'signed-in' || a.slack.linked !== true || a.slack.session || a.slack.keepSignedOut) continue
      if (now - (this.autoFailed.get(a.id) ?? 0) < AUTO_SLACK_RETRY) continue
      void this.start(a.id, true).then((r) => {
        if (r === 'failed') this.autoFailed.set(a.id, Date.now())
        else if (r !== 'skipped') this.autoFailed.delete(a.id)
      })
    }
  }

  setAuto(on: boolean) {
    this.store.autoSlack = on
    if (!on) return
    this.autoFailed.clear()
    this.autoSignIn()
  }

  /** Sign out of Slack only. Automatic sign-in leaves the account alone until Slack is opened again. */
  signOut(id: string): Promise<void> {
    // Any sign-in still running or waiting for a turn drops its result.
    this.bump(id)
    return this.records.slackLocked(id, async () => {
      const a = this.store.find(id)
      if (!a) return
      await this.records.backend(a.partition).signOutSlack()
      this.autoFailed.delete(id)
      this.records.setSlack(id, { session: false, keepSignedOut: true })
    })
  }
}
