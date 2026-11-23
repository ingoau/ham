// Pure helpers for reading Hack Club Auth emails out of a linked inbox.

export const HCA_SENDER = 'auth@hackclub.com'

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
