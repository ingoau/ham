import type { ReactNode } from 'react'
import { useNow } from '../hooks'

/** Re-renders only itself every second, so a countdown doesn't re-render the tree around it. */
export function Ticking({ children }: { children(now: number): ReactNode }) {
  const now = useNow()
  return <>{children(now)}</>
}
