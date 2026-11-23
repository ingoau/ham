// Pure helpers that turn auth.hackclub.com responses into sign-in steps.
// Paths come from hackclub/auth's config/routes.rb and LoginsController.

export const AUTH_ORIGIN = 'https://auth.hackclub.com'

export interface RawResponse {
  status: number
  /** Absolute URL from the Location header, for 3xx responses. */
  location: string | null
  body: string
}

export type LoginRedirect =
  | { kind: 'attempt'; attemptPath: string }
  | { kind: 'webauthn'; attemptPath: string }
  | { kind: 'totp'; attemptPath: string }
  | { kind: 'backup'; attemptPath: string }
  | { kind: 'signup' }
  | { kind: 'login' }
  | { kind: 'done' }
  | { kind: 'other'; path: string }

const ATTEMPT = /^\/login\/([A-Za-z0-9]+)(?:\/(totp|webauthn|backup_code))?\/?$/

/** Classify where a login-related redirect points. */
export function classifyLoginRedirect(location: string): LoginRedirect {
  let url: URL
  try {
    url = new URL(location, AUTH_ORIGIN)
  } catch {
    return { kind: 'other', path: location }
  }
  if (url.origin !== AUTH_ORIGIN) return { kind: 'other', path: url.href }
  const path = url.pathname
  if (path === '/signup') return { kind: 'signup' }
  if (path === '/login' || path === '/login/') return { kind: 'login' }
  const m = ATTEMPT.exec(path)
  if (m) {
    const attemptPath = `/login/${m[1]}`
    switch (m[2]) {
      case 'totp':
        return { kind: 'totp', attemptPath }
      case 'webauthn':
        return { kind: 'webauthn', attemptPath }
      case 'backup_code':
        return { kind: 'backup', attemptPath }
      default:
        return { kind: 'attempt', attemptPath }
    }
  }
  // Any other page on the site (/, /welcome, a return_to) means the login finished.
  return { kind: 'done' }
}

/** Whether a response to an authenticated page means the session is gone. */
export function isSignedOutRedirect(res: RawResponse): boolean {
  if (res.status < 300 || res.status >= 400 || !res.location) return false
  try {
    const path = new URL(res.location, AUTH_ORIGIN).pathname
    return path === '/welcome' || path === '/login' || path.startsWith('/login/')
  } catch {
    return false
  }
}

/** Login codes arrive formatted like "123-456". The server only wants digits. */
export function normalizeCode(code: string): string {
  return code.replace(/[^0-9]/g, '')
}

/** Backup codes: keep letters, digits and dashes. */
export function normalizeBackupCode(code: string): string {
  return code.replace(/[^A-Za-z0-9-]/g, '')
}

export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
}
