/** Compare dotted versions. Pre-release suffixes sort before the plain version. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const [main, pre] = v.replace(/^v/, '').split('-', 2)
    return { nums: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null }
  }
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0)
    if (d !== 0) return d > 0
  }
  if (a.pre === b.pre) return false
  if (a.pre === null) return true // 1.0.0 is newer than 1.0.0-beta
  if (b.pre === null) return false
  return a.pre > b.pre
}
