const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function isEmail(value: string): boolean {
  return EMAIL.test(value)
}

/** Emails from pasted text: split on newlines, commas and semicolons. */
export function parseEmailList(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL.test(s))
}
