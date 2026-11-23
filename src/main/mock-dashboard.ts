// Stand-in pages for the embedded dashboard in mock mode (HAM_MOCK=1), used for
// demos and screenshots. They are deliberately plain and are not a copy of
// the real Hack Club Auth site.

const PAGES: Record<string, { title: string; body: string }> = {
  '/': {
    title: 'Home',
    body: `<p>This is a stand-in for the Hack Club Auth dashboard. In the real app this view shows auth.hackclub.com, signed in as this account.</p>
      <ul>
        <li><a href="https://auth.hackclub.com/addresses">Manage your addresses</a></li>
        <li><a href="https://auth.hackclub.com/security">Security settings</a></li>
        <li><a href="https://auth.hackclub.com/oauth/authorized_applications">Apps you've authorized</a></li>
      </ul>
      <h2>Other links</h2>
      <ul>
        <li><a href="https://auth.hackclub.com/saml/idp_initiated/slack">Sign in to Slack with Hack Club</a> <em>(blocked in HAM)</em></li>
        <li><a href="https://hcb.hackclub.com/">hcb.hackclub.com</a> <em>(opens in your browser)</em></li>
      </ul>`
  },
  '/addresses': { title: 'Addresses', body: '<p>Your saved shipping addresses would appear here.</p><p><a href="https://auth.hackclub.com/">Back home</a></p>' },
  '/security': { title: 'Security', body: '<p>Two-factor settings and passkeys would appear here.</p><p><a href="https://auth.hackclub.com/">Back home</a></p>' }
}

export function mockDashboardPage(path: string): string {
  const page = PAGES[path] ?? { title: 'Page', body: `<p>${path}</p><p><a href="https://auth.hackclub.com/">Back home</a></p>` }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${page.title} · Hack Club Auth (demo)</title>
<style>
  :root { color-scheme: light dark; --bg: #fafaf9; --fg: #1c1917; --muted: #57534e; --link: #b3243b; --card: #ffffff; --line: #e7e5e4; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --fg: #f5f5f4; --muted: #a8a29e; --link: #ff8a9b; --card: #292524; --line: #44403c; } }
  body { margin: 0; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  main { max-width: 640px; margin: 0 auto; padding: 40px 24px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 24px 28px; }
  h1 { margin: 0 0 8px; font-size: 24px; } h2 { font-size: 15px; margin: 24px 0 4px; color: var(--muted); }
  p, li { color: var(--fg); } em { color: var(--muted); } a { color: var(--link); }
  .tag { display: inline-block; font-size: 12px; font-weight: 600; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; margin-bottom: 12px; }
</style></head>
<body data-path="${path}"><main><div class="card"><span class="tag">Demo mode</span><h1>${page.title}</h1>${page.body}</div></main></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
