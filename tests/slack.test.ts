import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, nativeTheme: {}, shell: {} }))
const { judgeSlackNavigation, chromeUserAgent, isSlackSessionCookie } = await import('../src/main/slack')

describe('judgeSlackNavigation', () => {
  it.each([
    'https://app.slack.com/client',
    'https://hackclub.enterprise.slack.com/sso/saml',
    'https://a.slack-edge.com/x.js',
    'https://auth.hackclub.com/saml/idp_initiated/slack',
    'https://auth.hackclub.com/saml/auth',
    'https://auth.hackclub.com/'
  ])('allows %s', (url) => expect(judgeSlackNavigation(url)).toBe('allow'))

  it('blocks the desktop app hand-off', () => {
    expect(judgeSlackNavigation('slack://open?team=T0')).toBe('block')
  })

  it('treats HCA sign-in pages as a signed-out session', () => {
    expect(judgeSlackNavigation('https://auth.hackclub.com/saml/welcome')).toBe('signed-out')
    expect(judgeSlackNavigation('https://auth.hackclub.com/login')).toBe('signed-out')
  })

  it('sends everything else to the browser', () => {
    expect(judgeSlackNavigation('https://github.com/hackclub')).toBe('external')
    expect(judgeSlackNavigation('https://auth.hackclub.com/oauth/authorize?x=1')).toBe('external')
    expect(judgeSlackNavigation('https://slack.com.evil.example/')).toBe('external')
  })
})

describe('chromeUserAgent', () => {
  it('drops the Electron and app tokens', () => {
    const ua = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) ham/0.1.1 Chrome/140.0.0.0 Electron/45.4.1 Safari/537.36'
    expect(chromeUserAgent(ua)).toBe('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
  })
})

describe('isSlackSessionCookie', () => {
  it('matches only d on slack.com', () => {
    expect(isSlackSessionCookie({ name: 'd', domain: '.slack.com' })).toBe(true)
    expect(isSlackSessionCookie({ name: 'd', domain: 'app.slack.com' })).toBe(true)
    expect(isSlackSessionCookie({ name: 'd-s', domain: '.slack.com' })).toBe(false)
    expect(isSlackSessionCookie({ name: 'd', domain: '.auth.hackclub.com' })).toBe(false)
    expect(isSlackSessionCookie({ name: 'd', domain: 'slack.com.evil.example' })).toBe(false)
  })
})
