import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasCodeField, parseCsrf, parseErrors, parseProfile, parseSlackId } from '../src/main/auth/pages'
import {
  classifyLoginRedirect,
  isSignedOutRedirect,
  isValidEmail,
  normalizeBackupCode,
  normalizeCode
} from '../src/main/auth/flow'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('parseCsrf', () => {
  it('reads the meta token, not a form token', () => {
    expect(parseCsrf(fixture('identity_edit.html'))).toBe('FIXTURE_CSRF_TOKEN_123')
  })
  it('returns null when missing', () => {
    expect(parseCsrf('<html></html>')).toBeNull()
  })
})

describe('parseProfile', () => {
  it('reads name and phone, decoding entities', () => {
    expect(parseProfile(fixture('identity_edit.html'))).toEqual({
      firstName: 'Fiona',
      lastName: "O'Hackworth",
      phone: '',
      hasLegalName: false
    })
  })
  it('spots the legal name notice', () => {
    expect(parseProfile(fixture('identity_edit_legal.html'))).toEqual({
      firstName: 'Sam',
      lastName: 'Rivera',
      phone: '+44 7700 900123',
      hasLegalName: true
    })
  })
  it('returns null on a page without the form', () => {
    expect(parseProfile(fixture('login_email.html'))).toBeNull()
  })
})

describe('parseErrors', () => {
  it('reads validation messages', () => {
    expect(parseErrors(fixture('identity_edit_errors.html'))).toEqual(["Last name can't be blank"])
  })
  it('reads error flash banners', () => {
    expect(parseErrors(fixture('login_email.html'))).toEqual(['Invalid or expired code, please try again'])
  })
  it('ignores success and info banners', () => {
    expect(parseErrors(fixture('identity_edit.html'))).toEqual([])
    expect(parseErrors(fixture('identity_edit_legal.html'))).toEqual([])
  })
})

describe('parseSlackId', () => {
  it('reads a linked Slack ID', () => {
    expect(parseSlackId(fixture('slack_id_linked.html'))).toBe('U0123ABCD45')
  })
  it('knows when none is linked', () => {
    expect(parseSlackId(fixture('slack_id_none.html'))).toBeNull()
  })
  it("doesn't guess on other pages", () => {
    expect(parseSlackId(fixture('identity_edit.html'))).toBeUndefined()
  })
})

describe('hasCodeField', () => {
  it('finds the code input', () => {
    expect(hasCodeField(fixture('login_email.html'))).toBe(true)
    expect(hasCodeField(fixture('identity_edit.html'))).toBe(false)
  })
})

describe('classifyLoginRedirect', () => {
  it.each([
    ['https://auth.hackclub.com/login/AofDe4Q', { kind: 'attempt', attemptPath: '/login/AofDe4Q' }],
    ['/login/AofDe4Q/webauthn', { kind: 'webauthn', attemptPath: '/login/AofDe4Q' }],
    ['/login/AofDe4Q/totp', { kind: 'totp', attemptPath: '/login/AofDe4Q' }],
    ['/login/AofDe4Q/backup_code', { kind: 'backup', attemptPath: '/login/AofDe4Q' }],
    ['https://auth.hackclub.com/signup?email=a%40b.co', { kind: 'signup' }],
    ['https://auth.hackclub.com/login', { kind: 'login' }],
    ['https://auth.hackclub.com/', { kind: 'done' }],
    ['https://auth.hackclub.com/welcome', { kind: 'done' }]
  ])('%s', (location, expected) => {
    expect(classifyLoginRedirect(location)).toEqual(expected)
  })
  it('treats other origins as other', () => {
    expect(classifyLoginRedirect('https://slack.com/x').kind).toBe('other')
  })
})

describe('isSignedOutRedirect', () => {
  it('spots the welcome and login redirects', () => {
    const at = (location: string | null, status = 302) => ({ status, location, body: '' })
    expect(isSignedOutRedirect(at('https://auth.hackclub.com/welcome?return_to=%2Fidentity%2Fedit'))).toBe(true)
    expect(isSignedOutRedirect(at('https://auth.hackclub.com/login'))).toBe(true)
    expect(isSignedOutRedirect(at('https://auth.hackclub.com/identity/edit'))).toBe(false)
    expect(isSignedOutRedirect(at(null, 200))).toBe(false)
  })
})

describe('codes and emails', () => {
  it('normalizes codes', () => {
    expect(normalizeCode(' 684-629 ')).toBe('684629')
    expect(normalizeBackupCode(' ab12-cd34 ')).toBe('ab12-cd34')
  })
  it('checks emails loosely', () => {
    expect(isValidEmail('fiona@example.com')).toBe(true)
    expect(isValidEmail('fiona@example')).toBe(false)
    expect(isValidEmail('not an email')).toBe(false)
  })
})
