// "Launch Slack": Hack Club Slack in a popup window on the account's own
// partition. With no Slack session yet, it signs in through Hack Club Auth's
// IdP-initiated SAML (POST /saml/idp_initiated/slack), which uses the
// account's existing HCA session. The window stays on Slack: other links go to
// the system browser, and slack:// is blocked so it can't hand off to the
// desktop Slack app (signed in as someone else).
//
// Bulk and automatic Slack sign-ins run the same SAML sign-in in a hidden
// window, which closes as soon as Slack has set its session cookie.
import { BrowserWindow, nativeTheme, shell, type WebContents } from 'electron'
import { AUTH_ORIGIN } from './auth/flow'
import { isSafeExternalUrl } from './lockdown'
import { installPermissions, slackContents } from './permissions'

export const SLACK_CLIENT_URL = 'https://app.slack.com/client'

const SLACK_HOST = /(^|\.)(slack\.com|slack-edge\.com|slack-imgs\.com|slack-files\.com|slackb\.com|slack-core\.com|slack-redir\.net)$/i
const HCA_SAML_PATHS = new Set(['/saml/idp_initiated/slack', '/saml/auth'])

export type SlackVerdict = 'allow' | 'signed-out' | 'block' | 'external'

/** What happens to a navigation in the Slack window. */
export function judgeSlackNavigation(rawUrl: string): SlackVerdict {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'block'
  }
  if (url.protocol === 'about:') return 'allow'
  if (url.protocol === 'slack:') return 'block'
  if (url.protocol !== 'https:') return isSafeExternalUrl(rawUrl) ? 'external' : 'block'
  if (SLACK_HOST.test(url.hostname)) return 'allow'
  if (url.origin === AUTH_ORIGIN) {
    if (HCA_SAML_PATHS.has(url.pathname) || url.pathname === '/') return 'allow'
    // HCA sends signed-out sessions to these.
    if (['/saml/welcome', '/login', '/welcome'].includes(url.pathname)) return 'signed-out'
    return 'external'
  }
  return 'external'
}

/** A plain desktop Chrome user agent, for sites that turn away Electron. */
export function chromeUserAgent(defaultUa: string): string {
  return defaultUa
    .split(' ')
    .filter((p) => !/^(Electron|ham|HAM)\//.test(p))
    .join(' ')
}

export interface SlackLaunchOptions {
  partition: string
  email: string
  hasSession: boolean
  mock: boolean
  onSignedIn(): void
  onSignedOut(): void
}

interface GuardOptions {
  /** A hidden sign-in window: links never open in the system browser and it gets no extra permissions. */
  hidden: boolean
  onSignedIn(): void
  onSignedOut(): void
}

const open = new Map<string, BrowserWindow>()

export function launchSlack(opts: SlackLaunchOptions) {
  const existing = open.get(opts.partition)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }
  const win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 600,
    minHeight: 480,
    title: `Hack Club Slack · ${opts.email}`,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1d21' : '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      partition: opts.partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  open.set(opts.partition, win)
  win.on('closed', () => open.delete(opts.partition))
  win.on('page-title-updated', (e) => {
    e.preventDefault()
    win.setTitle(`${win.webContents.getTitle()} · ${opts.email}`)
  })
  const wc = win.webContents
  wc.setUserAgent(chromeUserAgent(wc.getUserAgent()))
  const signedOut = () => {
    if (!win.isDestroyed()) win.close()
    opts.onSignedOut()
  }
  lockDown(wc, { hidden: false, onSignedIn: opts.onSignedIn, onSignedOut: signedOut })

  if (opts.mock) {
    const html = `<!doctype html><meta charset="utf-8"><title>Slack (demo)</title><body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#1a1d21;color:#eee"><div><h1>Hack Club Slack (demo)</h1><p>Signed in as ${opts.email.replace(/[<>&"]/g, '')}.</p></div>`
    void wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    opts.onSignedIn()
    return
  }

  if (opts.hasSession) {
    void wc.loadURL(SLACK_CLIENT_URL)
    return
  }
  startSaml(wc, signedOut)
}

/**
 * Load the HCA home page, then submit its own Slack SSO form: a normal
 * same-origin POST with the page's CSRF token. `onNoToken` runs if the page
 * has none (usually HCA's session has ended, but it may be an error page).
 */
function startSaml(wc: WebContents, onNoToken: () => void) {
  let submitted = false
  const submitSaml = async () => {
    if (submitted) return
    submitted = true
    const ok = await wc
      .executeJavaScript(
        `(() => {
          const token = document.querySelector('meta[name="csrf-token"]')?.content
          if (!token) return false
          const f = document.createElement('form')
          f.method = 'post'
          f.action = '/saml/idp_initiated/slack'
          const i = document.createElement('input')
          i.type = 'hidden'; i.name = 'authenticity_token'; i.value = token
          f.appendChild(i)
          document.body.appendChild(f)
          f.submit()
          return true
        })()`
      )
      .catch(() => false)
    if (!ok) onNoToken()
  }
  wc.on('did-finish-load', () => {
    if (wc.isDestroyed()) return
    const url = new URL(wc.getURL())
    if (url.origin === AUTH_ORIGIN && url.pathname === '/') void submitSaml()
  })
  void wc.loadURL(`${AUTH_ORIGIN}/`)
}

export type HiddenSlackResult = 'signed-in' | 'signed-out' | 'failed'

/** How long a hidden sign-in may take before HAM gives up on it. */
export const HIDDEN_SIGN_IN_TIMEOUT = 60_000

/** Whether a cookie is Slack's session cookie (`d` on .slack.com). */
export function isSlackSessionCookie(cookie: { name: string; domain?: string }): boolean {
  return cookie.name === 'd' && /(^|\.)slack\.com$/i.test((cookie.domain ?? '').replace(/^\./, ''))
}

const hidden = new Map<string, { promise: Promise<HiddenSlackResult>; cancel(): void }>()

/**
 * Sign the partition in to Slack in a window nobody sees: the same SAML
 * sign-in as Launch Slack, closed as soon as Slack has set its session.
 * Resolves 'signed-out' if Hack Club's own session has ended, 'failed' if
 * Slack wanted more than SAML (or took too long).
 */
export function signInSlackHidden(partition: string, timeoutMs = HIDDEN_SIGN_IN_TIMEOUT): Promise<HiddenSlackResult> {
  const running = hidden.get(partition)
  if (running) return running.promise
  let cancel = () => {}
  const promise = new Promise<HiddenSlackResult>((resolve) => {
    const win = new BrowserWindow({
      show: false,
      width: 1240,
      height: 840,
      skipTaskbar: true,
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // A hidden window's timers are throttled, which would stall Slack's redirects.
        backgroundThrottling: false
      }
    })
    const wc = win.webContents
    const ses = wc.session
    let done = false
    let settle: NodeJS.Timeout | null = null
    const finish = (result: HiddenSlackResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (settle) clearTimeout(settle)
      ses.cookies.off('changed', onCookie)
      // Not from inside the navigation event that may have called this.
      setImmediate(() => {
        if (!win.isDestroyed()) win.destroy()
      })
      resolve(result)
    }
    // Slack sets its session cookie once SAML is done; give the rest of that response a moment to land.
    const onCookie = (_e: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
      if (!removed && isSlackSessionCookie(cookie) && !settle) settle = setTimeout(() => finish('signed-in'), 1500)
    }
    const timer = setTimeout(() => finish('failed'), timeoutMs)
    cancel = () => finish('failed')
    ses.cookies.on('changed', onCookie)
    win.on('closed', () => finish('failed'))
    wc.setUserAgent(chromeUserAgent(wc.getUserAgent()))
    wc.setAudioMuted(true)
    lockDown(wc, { hidden: true, onSignedIn: () => finish('signed-in'), onSignedOut: () => finish('signed-out') })
    wc.on('render-process-gone', () => finish('failed'))
    wc.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
      if (isMainFrame) finish('failed')
    })
    // A page without a token might be an error page: only HCA's sign-in pages (see lockDown) mean signed out.
    startSaml(wc, () => finish('failed'))
  })
  hidden.set(partition, { promise, cancel: () => cancel() })
  void promise.finally(() => hidden.delete(partition))
  return promise
}

/** Stop every hidden sign-in (when the main window closes, so they don't keep the app open). */
export function cancelHiddenSlack() {
  for (const h of [...hidden.values()]) h.cancel()
}

/** Close the partition's Slack window and stop any hidden sign-in (before signing out of Slack). */
export function closeSlack(partition: string) {
  const win = open.get(partition)
  if (win && !win.isDestroyed()) win.destroy()
  open.delete(partition)
  hidden.get(partition)?.cancel()
}

function lockDown(wc: WebContents, opts: GuardOptions) {
  let reportedIn = false
  const guard = (event: Electron.Event, url: string) => {
    const verdict = judgeSlackNavigation(url)
    if (verdict === 'allow') return
    event.preventDefault()
    if (verdict === 'signed-out') opts.onSignedOut()
    else if (verdict === 'external' && !opts.hidden) void shell.openExternal(url)
  }
  wc.on('will-navigate', (e) => guard(e, e.url))
  wc.on('will-redirect', (e) => guard(e, e.url))
  wc.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame) {
      const v = judgeSlackNavigation(e.url)
      if (v === 'block' || v === 'signed-out') e.preventDefault()
    }
  })
  wc.setWindowOpenHandler(({ url }) => {
    if (opts.hidden) return { action: 'deny' }
    const verdict = judgeSlackNavigation(url)
    if (verdict === 'allow') void wc.loadURL(url)
    else if (verdict === 'external') void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.on('did-navigate', (_e, url) => {
    if (reportedIn) return
    try {
      const u = new URL(url)
      if (SLACK_HOST.test(u.hostname) && (u.pathname.startsWith('/client') || u.hostname === 'app.slack.com')) {
        reportedIn = true
        opts.onSignedIn()
      }
    } catch {
      // ignore
    }
  })
  installPermissions(wc.session)
  // Only a window someone is looking at may use notifications, the mic and the camera.
  if (opts.hidden) return
  const id = wc.id
  slackContents.add(id)
  wc.once('destroyed', () => slackContents.delete(id))
}
