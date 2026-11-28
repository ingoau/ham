// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useBulkJob, type BulkOutcome } from '../../src/renderer/src/useBulkJob'

/** A promise you resolve by hand. */
function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const flush = () => act(async () => {})

describe('useBulkJob', () => {
  it('runs every item, keeps results in item order, and counts throws as failures', async () => {
    const { result } = renderHook(() => useBulkJob())
    let outcome: BulkOutcome<number, number> | null = null
    await act(async () => {
      outcome = await result.current.run({
        label: 'Doubling',
        items: [3, 1, 2, 4],
        concurrency: 2,
        fn: async (n) => {
          await new Promise((r) => setTimeout(r, n))
          if (n === 2) throw new Error('nope')
          return n * 2
        }
      })
    })
    expect(outcome!.stopped).toBe(false)
    expect(outcome!.results.map((r) => [r.index, r.ok, r.ok ? r.value : null])).toEqual([
      [0, true, 6],
      [1, true, 2],
      [2, false, null],
      [3, true, 8]
    ])
    expect(result.current.progress).toBeNull()
    expect(result.current.isRunning()).toBe(false)
  })

  it('runs no more than `concurrency` at once and reports progress', async () => {
    const { result } = renderHook(() => useBulkJob())
    const gates = [deferred(), deferred(), deferred()]
    let active = 0
    let peak = 0
    let job!: Promise<unknown>
    act(() => {
      job = result.current.run({
        label: 'Working',
        items: [0, 1, 2],
        concurrency: 2,
        fn: async (i) => {
          active++
          peak = Math.max(peak, active)
          await gates[i].promise
          active--
        }
      })
    })
    expect(result.current.progress).toEqual({ label: 'Working', done: 0, total: 3 })
    expect(result.current.isRunning()).toBe(true)
    gates[0].resolve()
    await flush()
    expect(result.current.progress).toMatchObject({ done: 1, total: 3 })
    gates[1].resolve()
    gates[2].resolve()
    await act(async () => {
      await job
    })
    expect(peak).toBe(2)
    expect(result.current.progress).toBeNull()
  })

  it('refuses a second job while one runs', async () => {
    const { result } = renderHook(() => useBulkJob())
    const gate = deferred()
    let first!: Promise<unknown>
    act(() => {
      first = result.current.run({ label: 'One', items: [1], fn: () => gate.promise })
    })
    let second: unknown = 'unset'
    await act(async () => {
      second = await result.current.run({ label: 'Two', items: [1], fn: async () => undefined })
    })
    expect(second).toBeNull()
    gate.resolve()
    await act(async () => {
      await first
    })
  })

  it('stops starting items once cancelled, and finishes the ones running', async () => {
    const { result } = renderHook(() => useBulkJob())
    const gate = deferred()
    const started: number[] = []
    let job!: Promise<BulkOutcome<number, void> | null>
    act(() => {
      job = result.current.run({
        label: 'Slow',
        items: [0, 1, 2, 3],
        fn: async (i) => {
          started.push(i)
          if (i === 0) await gate.promise
        }
      })
    })
    act(() => result.current.cancel())
    expect(result.current.progress).toMatchObject({ cancelling: true })
    gate.resolve()
    let outcome: BulkOutcome<number, void> | null = null
    await act(async () => {
      outcome = await job
    })
    expect(started).toEqual([0])
    expect(outcome!.stopped).toBe(true)
    expect(outcome!.results).toHaveLength(1)
  })
})
