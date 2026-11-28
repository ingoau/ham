import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** A callback whose identity never changes but always calls the latest `fn` (for memoised children and listeners). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, [])
}

/** The current time, updated every `interval` ms while `active`. */
export function useNow(active = true, interval = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [active, interval])
  return now
}
