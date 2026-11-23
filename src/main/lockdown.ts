// Rules for the embedded Hack Club Auth dashboard: it may browse
// auth.hackclub.com but never leave it or sign in to other apps.

export const ALLOWED_HOST = 'auth.hackclub.com'

export type NavigationVerdict = 'allow' | 'block-sso' | 'external'

// Paths on auth.hackclub.com that sign the user in to another app.
// /oauth/authorize: OAuth and OIDC (Doorkeeper). /saml/*: SAML, including the
// homepage's own launch buttons, which post to /saml/idp_initiated/:slug.
const SSO_PATHS = [/^\/oauth\/authorize(\/|$)/i, /^\/saml(\/|$)/i]

/** Decide what happens to a page or frame navigation in the dashboard view. */
export function judgeNavigation(rawUrl: string): NavigationVerdict {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'external'
  }
  if (url.protocol === 'about:' && url.href === 'about:blank') return 'allow'
  if (url.protocol !== 'https:') return 'external'
  if (url.hostname.toLowerCase() !== ALLOWED_HOST || (url.port !== '' && url.port !== '443')) {
    return 'external'
  }
  let path: string
  try {
    path = decodeURIComponent(url.pathname).replace(/\/{2,}/g, '/')
  } catch {
    return 'block-sso' // a malformed path on HCA: refuse rather than guess
  }
  if (SSO_PATHS.some((re) => re.test(path))) return 'block-sso'
  return 'allow'
}

/** Only top-level and frame loads are policed; images, scripts and styles load freely. */
export function isNavigationResource(resourceType: string): boolean {
  return resourceType === 'mainFrame' || resourceType === 'subFrame'
}

/** URLs HAM will hand to the system browser. */
export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}
