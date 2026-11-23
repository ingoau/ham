import { useState } from 'react'

/**
 * Keeps the last non-null value around after it goes back to null, so a dialog
 * can keep its content while it animates out. `n` changes on every open, so a
 * reopened dialog starts fresh (use it as the key).
 */
export function useLatched<T>(value: T | null): { value: T | null; open: boolean; n: number } {
  const [state, setState] = useState({ value, open: value !== null, n: 0 })
  const open = value !== null
  if (open && (state.value !== value || !state.open)) setState({ value, open: true, n: state.open ? state.n : state.n + 1 })
  else if (!open && state.open) setState({ ...state, open: false })
  return { value: open ? value : state.value, open, n: state.open || !open ? state.n : state.n + 1 }
}
