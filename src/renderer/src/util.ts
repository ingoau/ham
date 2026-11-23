import type { Account } from '@shared/types'

// Colors that keep white initials at 4.5:1 or better.
const AVATAR_COLORS = ['#2f6fb3', '#7a4fb0', '#2f7d5b', '#b4532a', '#3f5bb8', '#a63d6b', '#3d7a8a', '#6b6b2f']

export function avatarColor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function initials(a: Pick<Account, 'firstName' | 'lastName' | 'email'>): string {
  const s = `${a.firstName.trim().charAt(0)}${a.lastName.trim().charAt(0)}`.toUpperCase()
  return s || a.email.charAt(0).toUpperCase()
}

export function displayName(a: Pick<Account, 'firstName' | 'lastName' | 'email'>): string {
  return `${a.firstName} ${a.lastName}`.trim() || a.email
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(iso) - Date.now()
  return Number.isNaN(ms) ? null : Math.ceil(ms / 86_400_000)
}

export function matches(a: Account, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${a.firstName} ${a.lastName} ${a.email}`.toLowerCase().includes(q)
}
