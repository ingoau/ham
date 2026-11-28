// What the account service's parts share: the stored accounts, one backend
// per partition, and the change notification the UI listens to.
import type { Account, PendingInfo, SlackInfo } from '@shared/types'
import type { AuthBackend, BackendFactory } from './auth/backend'
import type { Store, StoredAccount } from './store'

export type Toast = (text: string, kind: 'success' | 'error' | 'info') => void

export const freshPending = (): PendingInfo => ({
  startedAt: null,
  startsAt: null,
  autoCode: null,
  second: 'totp',
  message: null,
  expired: false
})

export const noSlack = (): SlackInfo => ({ linked: null, session: false, profile: {} })

export function toPublic(a: StoredAccount): Account {
  const { partition, attemptPath, ...rest } = a
  void partition // never sent to the renderer
  void attemptPath
  return rest
}

export class AccountRecords {
  private readonly backends = new Map<string, AuthBackend>()
  private readonly slackQueue = new Map<string, Promise<unknown>>()

  constructor(
    readonly store: Store,
    private readonly makeBackend: BackendFactory,
    readonly onChange: () => void
  ) {}

  backend(partition: string): AuthBackend {
    let b = this.backends.get(partition)
    if (!b) {
      b = this.makeBackend(partition)
      this.backends.set(partition, b)
    }
    return b
  }

  dropBackend(partition: string) {
    this.backends.delete(partition)
  }

  update(id: string, patch: Partial<StoredAccount>): StoredAccount | null {
    const a = this.store.find(id)
    if (!a) return null
    const next = { ...a, ...patch }
    this.store.upsert(next)
    this.onChange()
    return next
  }

  patchPending(id: string, patch: Partial<PendingInfo>) {
    const a = this.store.find(id)
    if (!a) return
    this.update(id, { pending: { ...(a.pending ?? freshPending()), ...patch } })
  }

  setSlack(id: string, patch: Partial<SlackInfo>) {
    const a = this.store.find(id)
    if (a) this.update(id, { slack: { ...a.slack, ...patch } })
  }

  markSignedOut(id: string) {
    const a = this.store.find(id)
    if (a && a.status === 'signed-in') this.update(id, { status: 'signed-out' })
  }

  /** Run Slack reads and saves for one account one at a time, so an older read never lands on a newer save. */
  slackLocked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.slackQueue.get(id) ?? Promise.resolve()).then(fn, fn)
    this.slackQueue.set(id, run.catch(() => undefined))
    return run
  }
}
