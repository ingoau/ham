import { describe, expect, it } from 'vitest'
import { SlidingWindow, WINDOW_MS } from '../src/main/limits'

describe('SlidingWindow', () => {
  it('allows up to the limit, then refuses', () => {
    const w = new SlidingWindow(3)
    expect(w.take(0)).toBe(true)
    expect(w.take(1)).toBe(true)
    expect(w.take(2)).toBe(true)
    expect(w.take(3)).toBe(false)
    expect(w.available(3)).toBe(0)
  })

  it('frees slots as entries age out', () => {
    const w = new SlidingWindow(2)
    w.take(0)
    w.take(1000)
    expect(w.take(WINDOW_MS - 1)).toBe(false)
    expect(w.take(WINDOW_MS)).toBe(true)
  })

  it('estimates when queued requests start', () => {
    const w = new SlidingWindow(2)
    w.take(0)
    w.take(100)
    expect(w.freeAt(0, 200)).toBe(WINDOW_MS)
    expect(w.freeAt(1, 200)).toBe(WINDOW_MS + 100)
    expect(w.freeAt(2, 200)).toBe(2 * WINDOW_MS)
    const fresh = new SlidingWindow(5)
    expect(fresh.freeAt(4, 50)).toBe(50)
  })
})
