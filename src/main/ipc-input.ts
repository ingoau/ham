// Arguments from the renderer are untrusted: these coerce them to what the
// handlers expect, dropping anything else.
import type { Bounds } from '@shared/types'

/** A string (numbers are written out); anything else is empty. */
export function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

/** A list of strings, at most `max` long. Anything that isn't a list is empty. */
export function strArr(v: unknown, max = 10_000): string[] {
  if (!Array.isArray(v)) return []
  return v
    .slice(0, max)
    .filter((x) => typeof x === 'string' || typeof x === 'number')
    .map(String)
}

export function bool(v: unknown): boolean {
  return v === true
}

/** A finite number, or null. */
export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const MAX_COORD = 100_000

/** A rectangle of finite, sane numbers, or null. */
export function bounds(v: unknown): Bounds | null {
  if (!v || typeof v !== 'object') return null
  const b = v as Record<string, unknown>
  const [x, y, width, height] = [num(b.x), num(b.y), num(b.width), num(b.height)]
  if (x === null || y === null || width === null || height === null) return null
  if ([x, y, width, height].some((n) => Math.abs(n) > MAX_COORD)) return null
  return { x, y, width, height }
}

/** The handler for a method: own keys only, so `constructor` or `__proto__` find nothing. */
export function handlerFor<T>(handlers: Record<string, T>, method: unknown): T | undefined {
  return typeof method === 'string' && Object.hasOwn(handlers, method) ? handlers[method] : undefined
}
