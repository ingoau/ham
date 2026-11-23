// Pure helpers for reading Hack Club Auth emails out of a linked inbox.

import type { FoundAddress, MailSource } from '@shared/types'

export const HCA_SENDER = 'auth@hackclub.com'

/**
 * Hack Club Slack emails: anything from slack.com whose body names the Hack Club
 * workspace ("hackclub.enterprise.slack.com", "the Hack Club workspace").
 * The server does the filtering, so message bodies are never downloaded.
 */
export const SLACK_SEARCH = { from: 'slack.com', or: [{ body: 'hackclub' }, { body: 'Hack Club' }] }

/** Collects addresses and where each turned up. */
export class FoundSet {
  private map = new Map<string, Set<MailSource>>()

  add(addresses: string[], source: MailSource) {
    for (const raw of addresses) {
      const email = raw.trim().toLowerCase()
      // Skip the senders' own addresses if they show up in Cc.
      if (!email.includes('@') || email.endsWith('@slack.com') || email === HCA_SENDER) continue
      let set = this.map.get(email)
      if (!set) this.map.set(email, (set = new Set()))
      set.add(source)
    }
  }

  /** Sorted by email. Addresses from HCA mail have an account; the rest are unknown until checked. */
  list(): FoundAddress[] {
    return [...this.map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([email, set]) => {
        const sources = (['hca', 'slack'] as const).filter((s) => set.has(s))
        return { email, sources, hasAccount: set.has('hca') ? true : null }
      })
  }
}

/**
 * Fill in hasAccount for addresses only seen in Slack mail, a few at a time.
 * `check` resolves true/false, or null when it couldn't tell.
 */
export async function checkAccounts(
  found: FoundAddress[],
  check: (email: string) => Promise<boolean | null>,
  { concurrency = 3, limit = 300 } = {}
): Promise<FoundAddress[]> {
  const todo = found.filter((f) => f.hasAccount === null).slice(0, limit)
  const results = new Map<string, boolean | null>()
  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const f = todo[next++]
      results.set(f.email, await check(f.email).catch(() => null))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker))
  return found.map((f) => (results.has(f.email) ? { ...f, hasAccount: results.get(f.email) ?? null } : f))
}

/** "684-629 is your Hack Club login code" → "684629". */
export function codeFromSubject(subject: string | undefined | null): string | null {
  const m = /(\d{3})-?(\d{3})\s+is your Hack Club login code/i.exec(subject ?? '')
  return m ? `${m[1]}${m[2]}` : null
}

/** Parse "Delivered-To" and "X-Original-To" out of a raw header block. */
export function headerAddresses(raw: string): string[] {
  const out: string[] = []
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^(delivered-to|x-original-to)\s*:\s*(.+)$/i.exec(line)
    if (!m) continue
    for (const addr of m[2].match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []) out.push(addr.toLowerCase())
  }
  return out
}

/** Every address a message was delivered to: To, Cc, plus catch-all delivery headers. */
export function recipientsOf(
  envelope: { to?: { address?: string }[]; cc?: { address?: string }[] } | undefined,
  rawHeaders: string
): string[] {
  const set = new Set<string>()
  for (const a of [...(envelope?.to ?? []), ...(envelope?.cc ?? [])]) {
    if (a.address) set.add(a.address.toLowerCase())
  }
  for (const a of headerAddresses(rawHeaders)) set.add(a)
  return [...set]
}

/** Clock slack between this computer and the mail server when matching codes to attempts. */
export const CLOCK_SKEW_MS = 15_000

export interface CodeMail {
  key: string
  code: string
  recipients: string[]
  receivedAt: number
}

export interface Expectation {
  accountId: string
  email: string
  since: number
}

/**
 * Pick the newest unused code for each expectation: the recipient must be the
 * attempt's email and the mail must have arrived after the attempt started.
 */
export function matchCodes(mails: CodeMail[], expectations: Expectation[], used: Set<string>): { accountId: string; code: string; key: string }[] {
  const hits: { accountId: string; code: string; key: string }[] = []
  for (const exp of expectations) {
    const email = exp.email.toLowerCase()
    const best = mails
      .filter((m) => !used.has(m.key) && m.recipients.includes(email) && m.receivedAt >= exp.since - CLOCK_SKEW_MS)
      .sort((a, b) => b.receivedAt - a.receivedAt)[0]
    if (best) hits.push({ accountId: exp.accountId, code: best.code, key: best.key })
  }
  return hits
}

export function parseHostPort(input: string): { host: string; port: number } | null {
  const m = /^\s*([a-z0-9.-]+)(?::(\d{1,5}))?\s*$/i.exec(input)
  if (!m) return null
  const port = m[2] ? Number(m[2]) : 993
  if (port < 1 || port > 65535) return null
  return { host: m[1].toLowerCase(), port }
}
