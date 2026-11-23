import { gt, valid } from 'semver'

/** Whether `candidate` (e.g. a release tag like "v0.2.0") is newer than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = valid(candidate.replace(/^v/, ''))
  const b = valid(current.replace(/^v/, ''))
  return a !== null && b !== null && gt(a, b)
}
