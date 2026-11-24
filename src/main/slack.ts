// "Launch Slack": Hack Club Slack in a popup window on the account's own
// partition. With no Slack session yet, it signs in through Hack Club Auth's
// IdP-initiated SAML (POST /saml/idp_initiated/slack), which uses the
// account's existing HCA session. The window stays on Slack: other links go to
// the system browser, and slack:// is blocked so it can't hand off to the
// desktop Slack app (signed in as someone else).
import { BrowserWindow, nativeTheme, shell, type WebContents } from 'electron'
import { AUTH_ORIGIN } from './auth/flow'
import { isSafeExternalUrl } from './lockdown'
import { installPermissions, slackContents } from './permissions'

export const SLACK_CLIENT_URL = 'https://app.slack.com/client'

export const SLACK_HOST = /(^|\.)(slack\.com|slack-edge\.com|slack-imgs\.com|slack-files\.com|slackb\.com|slack-core\.com|slack-redir\.net)$/i
const HCA_SAML_PATHS = new Set(['/saml/idp_initiated/slack', '/saml/auth'])

/**
 * Run on the HCA home page: submit its own Slack SSO form, a normal same-origin
 * POST with the page's CSRF token. Resolves false if the page has no token.
 */
export const SUBMIT_SAML = `(() => {
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
  lockDown(wc, win, opts)

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
  // Load the HCA home page, then submit its own Slack SSO form: a normal
  // same-origin POST with the page's CSRF token.
  let submitted = false
  const submitSaml = async () => {
    if (submitted) return
    submitted = true
    const ok = await wc.executeJavaScript(SUBMIT_SAML).catch(() => false)
    if (!ok) {
      win.close()
      opts.onSignedOut()
    }
  }
  wc.on('did-finish-load', () => {
    const url = new URL(wc.getURL())
    if (url.origin === AUTH_ORIGIN && url.pathname === '/') void submitSaml()
  })
  void wc.loadURL(`${AUTH_ORIGIN}/`)
}

function lockDown(wc: WebContents, win: BrowserWindow, opts: SlackLaunchOptions) {
  let reportedIn = false
  const guard = (event: Electron.Event, url: string) => {
    const verdict = judgeSlackNavigation(url)
    if (verdict === 'allow') return
    event.preventDefault()
    if (verdict === 'signed-out') {
      win.close()
      opts.onSignedOut()
    } else if (verdict === 'external') {
      void shell.openExternal(url)
    }
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
  const id = wc.id
  slackContents.add(id)
  wc.once('destroyed', () => slackContents.delete(id))
  installPermissions(wc.session)
}
