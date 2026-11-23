import { describe, expect, it } from 'vitest'
import { FoundSet, checkAccounts, codeFromSubject, headerAddresses, matchCodes, parseHostPort, recipientsOf } from '../src/main/inbox-match'

describe('codeFromSubject', () => {
  it('reads the code and strips the hyphen', () => {
    expect(codeFromSubject('684-629 is your Hack Club login code')).toBe('684629')
    expect(codeFromSubject('Fwd: 684629 is your Hack Club login code')).toBe('684629')
    expect(codeFromSubject('Welcome to Hack Club')).toBeNull()
    expect(codeFromSubject(undefined)).toBeNull()
  })
})

describe('recipients', () => {
  it('collects To, Cc and catch-all headers', () => {
    const raw = 'Delivered-To: alt+1@example.com\r\nX-Original-To: Alt.One@Example.com\r\nSubject: hi\r\n'
    expect(headerAddresses(raw)).toEqual(['alt+1@example.com', 'alt.one@example.com'])
    expect(recipientsOf({ to: [{ address: 'Fiona@Example.com' }] }, raw).sort()).toEqual(
      ['alt+1@example.com', 'alt.one@example.com', 'fiona@example.com'].sort()
    )
  })
})

describe('matchCodes', () => {
  const mail = (key: string, code: string, to: string, at: number) => ({ key, code, recipients: [to], receivedAt: at })
  it('takes the newest code for the right recipient after the attempt started', () => {
    const mails = [
      mail('a', '111111', 'one@example.com', 1_000_000),
      mail('b', '222222', 'one@example.com', 2_000_000),
      mail('c', '333333', 'two@example.com', 2_000_000)
    ]
    expect(matchCodes(mails, [{ accountId: 'x', email: 'ONE@example.com', since: 1_900_000 }], new Set())).toEqual([
      { accountId: 'x', code: '222222', key: 'b' }
    ])
  })
  it('ignores used and old mail', () => {
    const mails = [mail('a', '111111', 'one@example.com', 1_000_000)]
    expect(matchCodes(mails, [{ accountId: 'x', email: 'one@example.com', since: 5_000_000 }], new Set())).toEqual([])
    expect(matchCodes(mails, [{ accountId: 'x', email: 'one@example.com', since: 0 }], new Set(['a']))).toEqual([])
  })
})

describe('parseHostPort', () => {
  it('defaults to 993', () => {
    expect(parseHostPort('imap.fastmail.com')).toEqual({ host: 'imap.fastmail.com', port: 993 })
    expect(parseHostPort('imap.mail.me.com:993')).toEqual({ host: 'imap.mail.me.com', port: 993 })
    expect(parseHostPort('bad host')).toBeNull()
  })
})

describe('Find in inbox', () => {
  it('merges sources per address and skips sender addresses', () => {
    const found = new FoundSet()
    found.add(['Both@Example.com', 'auth-only@example.com', 'auth@hackclub.com'], 'hca')
    found.add(['both@example.com', 'slack-only@example.com', 'notification@slack.com'], 'slack')
    expect(found.list()).toEqual([
      { email: 'auth-only@example.com', sources: ['hca'], hasAccount: true },
      { email: 'both@example.com', sources: ['hca', 'slack'], hasAccount: true },
      { email: 'slack-only@example.com', sources: ['slack'], hasAccount: null }
    ])
  })
  it('checks only Slack-only addresses, a few at a time', async () => {
    const found = new FoundSet()
    found.add(['a@example.com'], 'hca')
    found.add(['b@example.com', 'c@example.com', 'd@example.com', 'e@example.com'], 'slack')
    let running = 0
    let peak = 0
    const asked: string[] = []
    const result = await checkAccounts(
      found.list(),
      async (email) => {
        asked.push(email)
        peak = Math.max(peak, ++running)
        await new Promise((r) => setTimeout(r, 5))
        running--
        if (email === 'e@example.com') throw new Error('network')
        return email !== 'c@example.com'
      },
      { concurrency: 2 }
    )
    expect(asked.sort()).toEqual(['b@example.com', 'c@example.com', 'd@example.com', 'e@example.com'])
    expect(peak).toBe(2)
    expect(result.map((f) => f.hasAccount)).toEqual([true, true, false, true, null])
  })
})
