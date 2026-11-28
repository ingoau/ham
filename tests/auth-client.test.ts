import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawResponse } from '../src/main/auth/flow'

type Reply = RawResponse | Error
const net = vi.hoisted(() => ({
  routes: new Map<string, Reply[]>(),
  log: [] as string[],
  NetworkError: class NetworkError extends Error {}
}))

vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({
      cookies: { get: async () => [] },
      clearStorageData: async () => {},
      clearCache: async () => {}
    })
  }
}))
// Replies are queued per "METHOD path"; a missing one is a 404.
vi.mock('../src/main/http', () => ({
  NetworkError: net.NetworkError,
  request: async (_ses: unknown, path: string, opts: { form?: Record<string, string> } = {}) => {
    const key = `${opts.form ? 'POST' : 'GET'} ${path}`
    net.log.push(key)
    const reply = net.routes.get(key)?.shift() ?? { status: 404, location: null, body: '' }
    if (reply instanceof Error) throw reply
    return reply
  }
}))

const { AuthClient } = await import('../src/main/auth/client')
const { NetworkError } = await import('../src/main/http')

const ORIGIN = 'https://auth.hackclub.com'
const page = (body = '', status = 200): RawResponse => ({ status, location: null, body })
const form = (token = 'tok') => page(`<html><head><meta name="csrf-token" content="${token}"></head><body></body></html>`)
const redirect = (path: string): RawResponse => ({ status: 302, location: ORIGIN + path, body: '' })
const offline = () => new NetworkError("Can't reach auth.hackclub.com. Check your internet connection.")

function on(key: string, ...replies: Reply[]) {
  net.routes.set(key, [...(net.routes.get(key) ?? []), ...replies])
}

beforeEach(() => {
  net.routes.clear()
  net.log.length = 0
})

describe('startLogin', () => {
  it('sends the email and loads the code form', async () => {
    on('GET /login', form())
    on('POST /login', redirect('/login/AbC1'))
    on('GET /login/AbC1', form('tok2'))
    const c = new AuthClient('p')
    expect(await c.startLogin('A@Example.com')).toEqual({ kind: 'code' })
    expect(c.attemptPath()).toBe('/login/AbC1')
  })

  it('reports a network error before the email was sent as not sent', async () => {
    on('GET /login', offline())
    expect(await new AuthClient('p').startLogin('a@example.com')).toEqual({ kind: 'network', message: expect.stringContaining("Can't reach"), sent: false })
    expect(net.log).toEqual(['GET /login'])
  })

  it('reports a network error on the email post as maybe sent', async () => {
    on('GET /login', form())
    on('POST /login', offline())
    expect(await new AuthClient('p').startLogin('a@example.com')).toMatchObject({ kind: 'network', sent: true })
  })

  it('still counts as sent when only the code form failed to load, and loads it before verifying', async () => {
    on('GET /login', form())
    on('POST /login', redirect('/login/AbC1'))
    on('GET /login/AbC1', offline(), form('tok2'))
    on('POST /login/AbC1/verify', redirect('/'))
    const c = new AuthClient('p')
    expect(await c.startLogin('a@example.com')).toEqual({ kind: 'code' })
    expect(await c.verifyEmailCode('123-456')).toEqual({ kind: 'done' })
    expect(net.log.slice(-2)).toEqual(['GET /login/AbC1', 'POST /login/AbC1/verify'])
  })

  it('maps rate limits, unknown emails, locks and odd replies', async () => {
    on('GET /login', page('', 429))
    expect(await new AuthClient('p').startLogin('a@example.com')).toEqual({ kind: 'rate-limited' })

    on('GET /login', form())
    on('POST /login', redirect('/signup'))
    expect(await new AuthClient('p').startLogin('a@example.com')).toEqual({ kind: 'no-account' })

    on('GET /login', form(), page('<div class="banner danger">Account locked.</div>'))
    on('POST /login', redirect('/login'))
    expect(await new AuthClient('p').startLogin('a@example.com')).toEqual({ kind: 'locked', message: 'Account locked.' })

    on('GET /login', form())
    on('POST /login', page('', 500))
    expect(await new AuthClient('p').startLogin('a@example.com')).toEqual({ kind: 'unexpected', message: 'Unexpected response (500).' })

    on('GET /login', page('no token here'))
    expect(await new AuthClient('p').startLogin('a@example.com')).toMatchObject({ kind: 'unexpected' })
  })

  it('skips the passkey step for passkey accounts', async () => {
    on('GET /login', form())
    on('POST /login', redirect('/login/AbC1/webauthn'))
    on('GET /login/AbC1/webauthn', form())
    on('POST /login/AbC1/webauthn/skip', redirect('/login/AbC1'))
    on('GET /login/AbC1', form())
    expect(await new AuthClient('p').startLogin('a@example.com')).toEqual({ kind: 'code' })
    expect(net.log).toContain('POST /login/AbC1/webauthn/skip')
  })

  it('reports other failures as unexpected', async () => {
    on('GET /login', new Error('boom'))
    expect(await new AuthClient('p').startLogin('a@example.com')).toEqual({ kind: 'unexpected', message: 'boom' })
  })
})

describe('verifying codes', () => {
  async function started() {
    on('GET /login', form())
    on('POST /login', redirect('/login/AbC1'))
    on('GET /login/AbC1', form())
    const c = new AuthClient('p')
    await c.startLogin('a@example.com')
    net.log.length = 0
    return c
  }

  it('maps the next step', async () => {
    const c = await started()
    on('POST /login/AbC1/verify', redirect('/login/AbC1/totp'))
    on('GET /login/AbC1/totp', form())
    expect(await c.verifyEmailCode('123456')).toEqual({ kind: 'totp' })
    on('POST /login/AbC1/totp', redirect('/'))
    expect(await c.verifySecondFactor('totp', '654 321')).toEqual({ kind: 'done' })
  })

  it('keeps an accepted code when the next form fails to load', async () => {
    const c = await started()
    on('POST /login/AbC1/verify', redirect('/login/AbC1/totp'))
    on('GET /login/AbC1/totp', offline(), form())
    expect(await c.verifyEmailCode('123456')).toEqual({ kind: 'totp' })
    on('POST /login/AbC1/totp', redirect('/'))
    expect(await c.verifySecondFactor('totp', '654321')).toEqual({ kind: 'done' })
    expect(net.log).toEqual(['POST /login/AbC1/verify', 'GET /login/AbC1/totp', 'GET /login/AbC1/totp', 'POST /login/AbC1/totp'])
  })

  it('reports a wrong code with the page’s message', async () => {
    const c = await started()
    on('POST /login/AbC1/verify', page('<div class="banner error">Invalid code</div>', 422))
    expect(await c.verifyEmailCode('000000')).toEqual({ kind: 'invalid', message: 'Invalid code' })
  })

  it('reports network errors, and whether the code went out', async () => {
    const c = await started()
    on('POST /login/AbC1/verify', offline())
    expect(await c.verifyEmailCode('123456')).toMatchObject({ kind: 'network', sent: true })

    const d = await started()
    on('POST /login/AbC1/verify', redirect('/login/AbC1/totp'))
    on('GET /login/AbC1/totp', offline(), offline())
    await d.verifyEmailCode('123456')
    expect(await d.verifySecondFactor('totp', '654321')).toMatchObject({ kind: 'network', sent: false })
  })

  it('says an attempt that went back to /login has expired', async () => {
    const c = await started()
    on('POST /login/AbC1/verify', redirect('/login'))
    on('GET /login', offline())
    expect(await c.verifyEmailCode('123456')).toEqual({ kind: 'unexpected', message: 'This sign-in has expired. Start again.' })
  })

  it('without an attempt, says it has expired', async () => {
    expect(await new AuthClient('p').verifyEmailCode('123456')).toEqual({ kind: 'unexpected', message: 'This sign-in has expired. Start again.' })
  })
})
