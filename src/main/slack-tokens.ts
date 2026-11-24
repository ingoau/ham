// "Slack tokens": a new Slack sign-in for an account, made in a throwaway
// in-memory partition so it isn't the Slack session HAM itself uses. The
// account's Hack Club Auth cookies are copied in, a hidden window runs Slack's
// SSO (HCA's IdP-initiated SAML, as Launch Slack does), and the web client's
// tokens are read from app.slack.com/auth plus the `d` cookie. The partition is
// wiped afterwards and HAM keeps nothing. It doesn't sign out of either site:
// the HCA cookies are the account's own session, and signing out of Slack would
// end the tokens.
import { BrowserWindow, session, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import type { SlackTokens } from '@shared/types'
import { AUTH_ORIGIN } from './auth/flow'
import { SLACK_HOST, SUBMIT_SAML, chromeUserAgent, judgeSlackNavigation } from './slack'
import { HACK_CLUB_TEAM, parseClientTokens } from './slack-profile'

const AUTH_URLS = ['https://app.slack.com/auth?app=client', `https://app.slack.com/auth?app=client&return_to=%2Fclient%2F${HACK_CLUB_TEAM}`]
const TIMEOUT_MS = 90_000
const POLL_MS = 2_000

/** HCA turned the copied session away: the account is signed out. */
export class TokensSignedOut extends Error {}
/** Slack's sign-in didn't finish. `message` is for people. */
export class TokensFailed extends Error {}

/** Copy the cookies a request to `url` would send from one session into another. */
export async function copyCookies(from: Session, to: Session, url: string) {
  for (const c of await from.cookies.get({ url })) {
    const host = c.domain?.replace(/^\./, '') ?? new URL(url).hostname
    await to.cookies.set({
      url: `https://${host}${c.path ?? '/'}`,
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      ...(c.hostOnly ? {} : { domain: c.domain }),
      ...(c.session ? {} : { expirationDate: c.expirationDate })
    })
  }
}

/** Slack's `d` cookie in a session, raw (still URL-encoded, as Slack set it). */
async function xoxdIn(ses: Session): Promise<string | null> {
  const all = await ses.cookies.get({ domain: 'slack.com', name: 'd' })
  return (all.find((c) => c.value.startsWith('xoxd-')) ?? all[0])?.value || null
}

/** The tokens, once the session has a Slack sign-in; null until then. */
async function readTokens(ses: Session): Promise<SlackTokens | null> {
  const xoxd = await xoxdIn(ses)
  if (!xoxd) return null
  for (const url of AUTH_URLS) {
    try {
      const res = await ses.fetch(url, { signal: AbortSignal.timeout(20_000), cache: 'no-store' } as RequestInit)
      if (!res.ok) continue
      const found = parseClientTokens(await res.text())
      if (found) return { ...found, xoxd }
    } catch {
      // try the next one, or the next poll
    }
  }
  return null
}

export async function fetchSlackTokens(partition: string): Promise<SlackTokens> {
  const tmp = session.fromPartition(`ham-tokens-${randomUUID()}`)
  tmp.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  tmp.setPermissionCheckHandler(() => false)
  tmp.on('will-download', (e) => e.preventDefault())
  let win: BrowserWindow | null = null
  try {
    await copyCookies(session.fromPartition(partition), tmp, `${AUTH_ORIGIN}/`)
    win = new BrowserWindow({
      show: false,
      webPreferences: { session: tmp, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    return await signIn(win, tmp)
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    await tmp.clearStorageData().catch(() => undefined)
    await tmp.clearCache().catch(() => undefined)
  }
}

function signIn(win: BrowserWindow, ses: Session): Promise<SlackTokens> {
  const wc = win.webContents
  wc.setAudioMuted(true)
  wc.setUserAgent(chromeUserAgent(wc.getUserAgent()))
  return new Promise<SlackTokens>((resolve, reject) => {
    let settled = false
    let submitted = false
    let checking = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      fn()
    }
    const fail = (err: Error) => settle(() => reject(err))
    const timer = setTimeout(() => fail(new TokensFailed('Slack didn’t finish signing in. Try again.')), TIMEOUT_MS)
    const check = async () => {
      if (settled || checking || !submitted) return
      checking = true
      try {
        const tokens = await readTokens(ses)
        if (tokens) settle(() => resolve(tokens))
      } finally {
        checking = false
      }
    }
    // Slack's SSO ends on the web client; poll as well, in case it stops on a page HAM doesn't expect.
    const poll = setInterval(() => void check(), POLL_MS)

    const guard = (event: Electron.Event, url: string) => {
      const verdict = judgeSlackNavigation(url)
      if (verdict === 'allow') return
      event.preventDefault()
      if (verdict === 'signed-out') fail(new TokensSignedOut())
    }
    wc.on('will-navigate', (e) => guard(e, e.url))
    wc.on('will-redirect', (e) => guard(e, e.url))
    wc.on('will-frame-navigate', (e) => {
      if (!e.isMainFrame && judgeSlackNavigation(e.url) !== 'allow') e.preventDefault()
    })
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('render-process-gone', () => fail(new TokensFailed('Slack’s sign-in page stopped working. Try again.')))
    wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      // -3 is a navigation HAM (or the page) cancelled.
      if (isMainFrame && code !== -3 && !submitted) fail(new TokensFailed(`Can’t reach Hack Club Auth (${description}).`))
    })
    wc.on('did-finish-load', () => {
      const url = new URL(wc.getURL())
      if (url.origin === AUTH_ORIGIN && url.pathname === '/' && !submitted) {
        submitted = true
        void wc
          .executeJavaScript(SUBMIT_SAML)
          .catch(() => false)
          .then((ok) => !ok && fail(new TokensSignedOut()))
      } else if (SLACK_HOST.test(url.hostname)) {
        void check()
      }
    })
    void wc.loadURL(`${AUTH_ORIGIN}/`).catch(() => undefined)
  })
}
