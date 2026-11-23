import type { HamApi } from '../shared/ipc'

declare global {
  interface Window {
    ham: HamApi
  }
}

export {}
