// Client-side rate limiting that mirrors auth.hackclub.com's Rack::Attack rules,
// so a big import queues instead of being rejected:
//   POST /login                     10 per IP per 5 minutes, 5 per email
//   verify + TOTP + backup checks   20 per IP per 5 minutes combined
export const WINDOW_MS = 5 * 60 * 1000
export const LOGIN_LIMIT = 10
export const LOGIN_PER_EMAIL_LIMIT = 5
export const CHECK_LIMIT = 20

export class SlidingWindow {
  constructor(
    readonly limit: number,
    readonly windowMs: number = WINDOW_MS,
    private log: number[] = []
  ) {}

  private prune(now: number) {
    this.log = this.log.filter((t) => now - t < this.windowMs)
  }

  available(now = Date.now()): number {
    this.prune(now)
    return Math.max(0, this.limit - this.log.length)
  }

  /** Use a slot. Returns false (and uses nothing) when none is free. */
  take(now = Date.now()): boolean {
    if (this.available(now) === 0) return false
    this.log.push(now)
    return true
  }

  /**
   * When the k-th request from now (0 = the next one) can go out, assuming
   * nothing else uses a slot meanwhile.
   */
  freeAt(k: number, now = Date.now()): number {
    this.prune(now)
    const free = this.limit - this.log.length
    if (k < free) return now
    const sorted = [...this.log].sort((a, b) => a - b)
    // Each further request waits for the oldest remaining entry to age out.
    const i = k - free
    const round = Math.floor(i / this.limit)
    const t = sorted[i % this.limit] ?? now
    return t + this.windowMs * (round + 1)
  }

  entries(now = Date.now()): number[] {
    this.prune(now)
    return [...this.log]
  }
}
