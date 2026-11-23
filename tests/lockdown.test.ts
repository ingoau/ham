import { describe, expect, it } from 'vitest'
import { isNavigationResource, isSafeExternalUrl, judgeNavigation } from '../src/main/lockdown'

describe('judgeNavigation', () => {
  it.each([
    'https://auth.hackclub.com/',
    'https://auth.hackclub.com/addresses',
    'https://auth.hackclub.com/identity/edit',
    'https://auth.hackclub.com/security',
    'https://AUTH.hackclub.com/passkeys',
    'https://auth.hackclub.com:443/activity',
    'https://auth.hackclub.com/oauth/authorized_applications',
    'about:blank'
  ])('allows %s', (url) => {
    expect(judgeNavigation(url)).toBe('allow')
  })

  it.each([
    'https://auth.hackclub.com/oauth/authorize?client_id=abc&redirect_uri=https://x.example',
    'https://auth.hackclub.com/oauth/authorize/native',
    'https://auth.hackclub.com/saml/idp_initiated/slack',
    'https://auth.hackclub.com/saml/auth?SAMLRequest=abc',
    'https://auth.hackclub.com/SAML/idp_initiated/slack',
    'https://auth.hackclub.com//saml/idp_initiated/slack',
    'https://auth.hackclub.com/%73aml/idp_initiated/slack'
  ])('blocks SSO at %s', (url) => {
    expect(judgeNavigation(url)).toBe('block-sso')
  })

  it.each([
    'https://hcb.hackclub.com/',
    'https://hackclub.com/',
    'https://auth.hackclub.com.evil.example/',
    'https://evil.example/?next=https://auth.hackclub.com',
    'http://auth.hackclub.com/',
    'https://auth.hackclub.com:8443/',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'not a url'
  ])('sends %s to the browser', (url) => {
    expect(judgeNavigation(url)).toBe('external')
  })
})

describe('isNavigationResource', () => {
  it('polices frames only', () => {
    expect(isNavigationResource('mainFrame')).toBe(true)
    expect(isNavigationResource('subFrame')).toBe(true)
    expect(isNavigationResource('image')).toBe(false)
    expect(isNavigationResource('script')).toBe(false)
    expect(isNavigationResource('xhr')).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('accepts web and mail links only', () => {
    expect(isSafeExternalUrl('https://hcb.hackclub.com')).toBe(true)
    expect(isSafeExternalUrl('mailto:team@hackclub.com')).toBe(true)
    expect(isSafeExternalUrl('file:///Applications')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('smb://share')).toBe(false)
  })
})
