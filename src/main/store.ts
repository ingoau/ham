// Persists the account list and window state as JSON in the app's data folder.
// No cookies, codes or tokens are ever written here: Chromium keeps those in
// each account's partition.
import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Account } from '@shared/types'

export interface StoredAccount extends Account {
  /** Electron session partition holding this account's cookies. */
  partition: string
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

interface StoreFile {
  version: 1
  accounts: StoredAccount[]
  window?: WindowState
  dismissedUpdate?: string
}

export class Store {
  private data: StoreFile
  private readonly file: string

  constructor(file = join(app.getPath('userData'), 'accounts.json')) {
    this.file = file
    this.data = this.load()
  }

  private load(): StoreFile {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile
      if (parsed.version === 1 && Array.isArray(parsed.accounts)) return parsed
    } catch {
      // first run, or an unreadable file: start empty
    }
    return { version: 1, accounts: [] }
  }

  private flush() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
  }

  get accounts(): StoredAccount[] {
    return this.data.accounts
  }

  find(id: string): StoredAccount | undefined {
    return this.data.accounts.find((a) => a.id === id)
  }

  findByEmail(email: string): StoredAccount | undefined {
    const lower = email.trim().toLowerCase()
    return this.data.accounts.find((a) => a.email.toLowerCase() === lower)
  }

  upsert(account: StoredAccount) {
    const i = this.data.accounts.findIndex((a) => a.id === account.id)
    if (i === -1) this.data.accounts.push(account)
    else this.data.accounts[i] = account
    this.flush()
  }

  remove(id: string) {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id)
    this.flush()
  }

  move(id: string, toIndex: number) {
    const from = this.data.accounts.findIndex((a) => a.id === id)
    if (from === -1) return
    const [item] = this.data.accounts.splice(from, 1)
    this.data.accounts.splice(Math.max(0, Math.min(toIndex, this.data.accounts.length)), 0, item)
    this.flush()
  }

  get window(): WindowState | undefined {
    return this.data.window
  }

  set window(state: WindowState | undefined) {
    this.data.window = state
    this.flush()
  }

  get dismissedUpdate(): string | undefined {
    return this.data.dismissedUpdate
  }

  set dismissedUpdate(version: string | undefined) {
    this.data.dismissedUpdate = version
    this.flush()
  }
}
