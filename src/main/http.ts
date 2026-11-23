// A small HTTP client on top of Electron's `net.request`, scoped to one session
// (one account's partition). Redirects are never followed: the auth flow reads
// them. `session.fetch` can't do that (it rejects with "Redirect was
// cancelled"), so this uses the lower-level request API, which still stores
// Set-Cookie from redirect responses in the session.
import { app, net, type Session } from 'electron'
import type { RawResponse } from './auth/flow'
import { AUTH_ORIGIN } from './auth/flow'

export class NetworkError extends Error {}

export interface HttpOptions {
  method?: 'GET' | 'POST'
  form?: Record<string, string>
  timeoutMs?: number
}

const userAgents = new WeakMap<Session, string>()

/**
 * A Chrome-style user agent with HAM's version at the end. The server shows
 * the parsed user agent in the account's Sessions list.
 */
export function hamUserAgent(ses: Session): string {
  let ua = userAgents.get(ses)
  if (!ua) {
    ua = ses
      .getUserAgent()
      .split(' ')
      .filter((part) => !/^(Electron|ham|HAM)\//.test(part))
      .join(' ')
      .concat(` HAM/${app.getVersion()}`)
    userAgents.set(ses, ua)
  }
  return ua
}

export function request(ses: Session, path: string, opts: HttpOptions = {}): Promise<RawResponse> {
  const url = path.startsWith('http') ? path : AUTH_ORIGIN + path
  const method = opts.method ?? (opts.form ? 'POST' : 'GET')
  return new Promise<RawResponse>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const req = net.request({
      url,
      method,
      session: ses,
      useSessionCookies: true,
      redirect: 'manual',
      cache: 'no-store'
    })
    const timer = setTimeout(() => {
      req.abort()
      finish(() => reject(new NetworkError('The request timed out.')))
    }, opts.timeoutMs ?? 30_000)

    req.setHeader('User-Agent', hamUserAgent(ses))
    req.setHeader('Accept', 'text/html,application/xhtml+xml')
    req.on('redirect', (status, _method, redirectUrl) => {
      req.abort()
      finish(() => resolve({ status, location: redirectUrl, body: '' }))
    })
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () =>
        finish(() => resolve({ status: res.statusCode, location: null, body: Buffer.concat(chunks).toString('utf8') }))
      )
      res.on('error', () => finish(() => reject(new NetworkError('The connection was interrupted.'))))
    })
    req.on('error', (err) => finish(() => reject(new NetworkError(friendlyNetError(err)))))

    if (opts.form) {
      req.setHeader('Content-Type', 'application/x-www-form-urlencoded')
      req.write(new URLSearchParams(opts.form).toString())
    }
    req.end()
  })
}

function friendlyNetError(err: Error): string {
  const msg = err.message || ''
  if (/INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE/.test(msg)) {
    return "Can't reach auth.hackclub.com. Check your internet connection."
  }
  if (/TIMED_OUT/.test(msg)) return 'auth.hackclub.com took too long to respond.'
  return `Network error: ${msg}`
}
