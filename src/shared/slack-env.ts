// Slack tokens as .env lines, with the names and quoting hc-slack-auth uses
// (github.com/ingoau/hc-slack-auth), so either tool's output drops into the same .env.
import type { SlackTokens } from './types'

export type TokenKey = 'SLACK_XOXD' | 'SLACK_TEAM_XOXC' | 'SLACK_ENTERPRISE_XOXC'

export interface TokenRow {
  key: TokenKey
  label: string
  /** The workspace or org id the token belongs to. */
  id?: string
  value: string
}

/** The tokens in .env order, leaving out any Slack didn't give. */
export function tokenRows(t: SlackTokens): TokenRow[] {
  const rows: TokenRow[] = [{ key: 'SLACK_XOXD', label: 'xoxd', value: t.xoxd }]
  if (t.team) rows.push({ key: 'SLACK_TEAM_XOXC', label: 'xoxc · workspace', id: t.team.id, value: t.team.token })
  if (t.enterprise) rows.push({ key: 'SLACK_ENTERPRISE_XOXC', label: 'xoxc · enterprise', id: t.enterprise.id, value: t.enterprise.token })
  return rows
}

/** A double-quoted .env value. */
export const envValue = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Every row as KEY="value" lines. */
export const toEnv = (rows: TokenRow[]) => rows.map((r) => `${r.key}=${envValue(r.value)}`).join('\n')

/** The first five and last four characters: enough to tell tokens apart. */
export const maskToken = (v: string) => (v.length > 12 ? `${v.slice(0, 5)}…${v.slice(-4)}` : '…')
