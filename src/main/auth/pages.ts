// Everything HAM knows about the HTML that auth.hackclub.com serves lives here,
// so a markup change upstream only needs fixing in one place. Covered by
// tests/pages.test.ts with fixtures in tests/fixtures.
import { parse, type HTMLElement } from 'node-html-parser'

export interface ParsedProfile {
  firstName: string
  lastName: string
  phone: string
  hasLegalName: boolean
}

const LEGAL_NAME_NOTICE = /different legal name on file/i

function root(html: string): HTMLElement {
  return parse(html, { comment: false, blockTextElements: { script: false, style: false } })
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The Rails CSRF token from `<meta name="csrf-token">`. */
export function parseCsrf(html: string): string | null {
  const meta = root(html).querySelector('meta[name="csrf-token"]')
  return meta?.getAttribute('content') ?? null
}

/** Name and phone from the account settings page (`/identity/edit`). */
export function parseProfile(html: string): ParsedProfile | null {
  const doc = root(html)
  const input = (name: string) => doc.querySelector(`input[name="identity[${name}]"]`)
  const first = input('first_name')
  const last = input('last_name')
  if (!first || !last) return null
  return {
    firstName: first.getAttribute('value') ?? '',
    lastName: last.getAttribute('value') ?? '',
    phone: input('phone_number')?.getAttribute('value') ?? '',
    hasLegalName: LEGAL_NAME_NOTICE.test(doc.textContent)
  }
}

/**
 * Error messages on a page: the form's validation list (`.banner.danger li`)
 * and any error flash banners.
 */
export function parseErrors(html: string): string[] {
  const doc = root(html)
  const messages: string[] = []
  for (const banner of doc.querySelectorAll('.banner')) {
    const cls = banner.getAttribute('class') ?? ''
    if (!/\b(danger|error|alert)\b/.test(cls)) continue
    const items = banner.querySelectorAll('li')
    if (items.length > 0) {
      for (const li of items) messages.push(clean(li.textContent))
    } else {
      const text = clean(banner.textContent)
      if (text) messages.push(text)
    }
  }
  return [...new Set(messages.filter(Boolean))]
}

/**
 * The Slack ID on /slack-id: a "U…" id, null when the page says none is
 * linked, or undefined when the page isn't recognised.
 */
export function parseSlackId(html: string): string | null | undefined {
  const doc = root(html)
  const code = doc.querySelector('.slack-id-page code.slack-id, code.slack-id')
  const id = code?.textContent.trim()
  if (id && /^[UW][A-Z0-9]{6,}$/.test(id)) return id
  if (/No Slack ID linked/i.test(doc.textContent)) return null
  return undefined
}

/** Whether a page contains a form field named `code` (the login code pages). */
export function hasCodeField(html: string): boolean {
  return root(html).querySelector('input[name="code"]') !== null
}
