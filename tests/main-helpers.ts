// Shared by the main-process tests. Import after mocking 'electron'.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoredAccount } from '../src/main/store'

const dirs: string[] = []

/** A fresh accounts.json path in its own temp folder. */
export function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ham-test-'))
  dirs.push(dir)
  return join(dir, 'accounts.json')
}

export function removeTempDirs() {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
}

export function account(id: string, patch: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id,
    email: `${id}@example.com`,
    localName: '',
    firstName: '',
    lastName: '',
    phone: '',
    hasLegalName: false,
    status: 'signed-in',
    fresh: false,
    pinned: false,
    groupId: null,
    tagIds: [],
    expiresAt: null,
    addedAt: new Date().toISOString(),
    pending: null,
    slack: { linked: null, session: false, profile: {} },
    partition: `p-${id}`,
    attemptPath: null,
    ...patch
  }
}

/** Let pending promise chains run. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
