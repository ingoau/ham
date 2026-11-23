// One permission policy per account partition, shared by the dashboard view
// and the Slack window (a session has only one handler, so it lives here).
import type { Session } from 'electron'

const installed = new WeakSet<Session>()
/** webContents ids of Slack windows, which may also use notifications, mic and camera. */
export const slackContents = new Set<number>()

const SLACK_EXTRA = new Set(['notifications', 'media', 'fullscreen', 'clipboard-read'])

export function installPermissions(ses: Session) {
  if (installed.has(ses)) return
  installed.add(ses)
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'clipboard-sanitized-write') return callback(true)
    callback(wc !== null && slackContents.has(wc.id) && SLACK_EXTRA.has(permission))
  })
  ses.setPermissionCheckHandler((wc, permission) => {
    if (permission === 'clipboard-sanitized-write') return true
    return wc !== null && slackContents.has(wc.id) && SLACK_EXTRA.has(permission)
  })
}
