// One background job at a time (bulk edit, undo, bulk sign-out, Slack sign-in):
// runs `fn` over the items a few at a time, reports progress for the sidebar's
// progress card, and stops starting new items once cancelled.
import { useCallback, useRef, useState } from 'react'

export interface BulkProgress {
  label: string
  done: number
  total: number
  cancelling?: boolean
}

export interface BulkJob<T, R> {
  label: string
  items: readonly T[]
  /** How many items run at once (1: one after another). */
  concurrency?: number
  fn(item: T, index: number): Promise<R>
}

export type BulkResult<T, R> = { item: T; index: number; ok: true; value: R } | { item: T; index: number; ok: false; error: unknown }

export interface BulkOutcome<T, R> {
  /** One per item that ran, in item order. A throw counts as `ok: false`. */
  results: BulkResult<T, R>[]
  /** Cancelled before every item started. */
  stopped: boolean
}

export function useBulkJob() {
  const [progress, setProgress] = useState<BulkProgress | null>(null)
  const running = useRef(false)
  const cancelled = useRef(false)

  /** Run a job, or resolve null straight away if another one is running. */
  const run = useCallback(async <T, R>({ label, items, concurrency = 1, fn }: BulkJob<T, R>): Promise<BulkOutcome<T, R> | null> => {
    if (running.current) return null
    running.current = true
    cancelled.current = false
    const total = items.length
    const results: BulkResult<T, R>[] = []
    let next = 0
    let done = 0
    setProgress({ label, done: 0, total })
    const worker = async () => {
      while (next < total && !cancelled.current) {
        const index = next++
        const item = items[index]
        try {
          results.push({ item, index, ok: true, value: await fn(item, index) })
        } catch (error) {
          results.push({ item, index, ok: false, error })
        }
        done++
        setProgress((p) => ({ label, done, total, cancelling: p?.cancelling }))
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), total) }, worker))
    } finally {
      running.current = false
      setProgress(null)
    }
    results.sort((a, b) => a.index - b.index)
    return { results, stopped: next < total }
  }, [])

  /** Finish the items already running, then stop. */
  const cancel = useCallback(() => {
    if (!running.current) return
    cancelled.current = true
    setProgress((p) => (p ? { ...p, cancelling: true } : p))
  }, [])

  const isRunning = useCallback(() => running.current, [])

  return { progress, run, cancel, isRunning }
}
