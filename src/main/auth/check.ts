// HCA's public, read-only account check (GET /api/external/check?email=…).
// It answers "not_found" when no account has this primary email.
import { net } from 'electron'
import { ALLOWED_HOST } from '../lockdown'

export async function hcaAccountExists(email: string): Promise<boolean | null> {
  try {
    const url = `https://${ALLOWED_HOST}/api/external/check?email=${encodeURIComponent(email)}`
    const res = await net.fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const body = (await res.json()) as { result?: unknown }
    if (typeof body.result !== 'string') return null
    return body.result !== 'not_found'
  } catch {
    return null
  }
}

/** Demo mode: addresses starting with "no." have no account. */
export async function mockAccountExists(email: string): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 120))
  return !email.startsWith('no.')
}
