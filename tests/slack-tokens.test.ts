import { describe, expect, it, vi } from 'vitest'
import { maskToken, toEnv, tokenRows } from '@shared/slack-env'
import type { SlackTokens } from '@shared/types'

vi.mock('electron', () => ({ BrowserWindow: class {}, nativeTheme: {}, shell: {}, session: {} }))
const { copyCookies } = await import('../src/main/slack-tokens')

const tokens: SlackTokens = {
  userId: 'U1',
  xoxd: 'xoxd-abc%2Fdef%3D%3D',
  team: { id: 'T0266FRGM', token: 'xoxc-team-123456' },
  enterprise: { id: 'E09V59WQY1E', token: 'xoxc-org-654321' }
}

describe('.env output', () => {
  it('uses hc-slack-auth’s names, order and quoting', () => {
    expect(toEnv(tokenRows(tokens))).toBe(
      ['SLACK_XOXD="xoxd-abc%2Fdef%3D%3D"', 'SLACK_TEAM_XOXC="xoxc-team-123456"', 'SLACK_ENTERPRISE_XOXC="xoxc-org-654321"'].join('\n')
    )
  })
  it('leaves out tokens Slack didn’t give', () => {
    expect(tokenRows({ ...tokens, enterprise: null }).map((r) => r.key)).toEqual(['SLACK_XOXD', 'SLACK_TEAM_XOXC'])
  })
  it('escapes quotes and backslashes', () => {
    expect(toEnv([{ key: 'SLACK_XOXD', label: 'xoxd', value: 'a"b\\c' }])).toBe('SLACK_XOXD="a\\"b\\\\c"')
  })
  it('masks all but the ends', () => {
    expect(maskToken('xoxc-1234567890-abcd')).toBe('xoxc-…abcd')
    expect(maskToken('short')).toBe('…')
  })
})

describe('copyCookies', () => {
  it('copies host-only and domain cookies with their attributes', async () => {
    const set = vi.fn(async () => undefined)
    const from = {
      cookies: {
        get: async () => [
          { name: '_session', value: 's', domain: 'auth.hackclub.com', hostOnly: true, path: '/', secure: true, httpOnly: true, session: true, sameSite: 'lax' },
          { name: 'pref', value: 'p', domain: '.hackclub.com', hostOnly: false, path: '/', secure: true, httpOnly: false, session: false, expirationDate: 2e9, sameSite: 'no_restriction' }
        ]
      }
    }
    await copyCookies(from as never, { cookies: { set } } as never, 'https://auth.hackclub.com/')
    expect(set).toHaveBeenCalledWith({ url: 'https://auth.hackclub.com/', name: '_session', value: 's', path: '/', secure: true, httpOnly: true, sameSite: 'lax' })
    expect(set).toHaveBeenCalledWith({
      url: 'https://hackclub.com/',
      name: 'pref',
      value: 'p',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'no_restriction',
      domain: '.hackclub.com',
      expirationDate: 2e9
    })
  })
})
