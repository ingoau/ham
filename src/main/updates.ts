// Checks GitHub Releases for a newer HAM. There is no auto-update: the app
// shows a banner linking to the release page.
import { app, net } from 'electron'
import type { UpdateInfo } from '@shared/types'
import { isNewer } from '@shared/version'

const REPO = process.env.HAM_UPDATE_REPO ?? 'ingoau/ham'

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `HAM/${app.getVersion()}` }
    })
    // A private repository answers 404 to anonymous requests: no banner.
    if (!res.ok) return null
    const release = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean }
    if (!release.tag_name || !release.html_url || release.draft || release.prerelease) return null
    const version = release.tag_name.replace(/^v/, '')
    return isNewer(version, app.getVersion()) ? { version, url: release.html_url } : null
  } catch {
    return null
  }
}
