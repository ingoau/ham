// Renders Jinja-style (Nunjucks) templates in a sandboxed iframe: the main UI's
// CSP forbids eval, which Nunjucks needs, so templates run in their own
// opaque-origin frame (public/sandbox) and results come back by postMessage.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TemplateContext } from '@shared/fields'

export interface TemplateJob {
  tpl: string
  ctx: TemplateContext
}

export type TemplateResult = { ok: true; value: string } | { ok: false; error: string }

/** How long a batch may take before the frame is thrown away. */
export const RENDER_TIMEOUT_MS = 2000

export class TemplateTimeoutError extends Error {
  constructor() {
    super('Template took too long')
    this.name = 'TemplateTimeoutError'
  }
}

interface Waiter {
  resolve(results: TemplateResult[]): void
  reject(error: Error): void
}

export class TemplateEngine {
  private frame: HTMLIFrameElement | null = null
  private ready: Promise<void> | null = null
  private listener: ((event: MessageEvent) => void) | null = null
  private nextId = 1
  private readonly waiting = new Map<number, Waiter>()
  private readonly cache = new Map<string, TemplateResult>()

  constructor(
    private readonly timeoutMs = RENDER_TIMEOUT_MS,
    private readonly src = () => new URL('sandbox/index.html', document.baseURI).toString()
  ) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise((resolve) => {
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.setAttribute('aria-hidden', 'true')
      frame.tabIndex = -1
      frame.style.display = 'none'
      frame.src = this.src()
      this.listener = (event) => {
        if (event.source !== frame.contentWindow) return
        const data = event.data as { ready?: boolean; id?: number; results?: TemplateResult[] }
        if (data.ready) resolve()
        if (typeof data.id === 'number' && data.results) {
          this.waiting.get(data.id)?.resolve(data.results)
          this.waiting.delete(data.id)
        }
      }
      window.addEventListener('message', this.listener)
      document.body.appendChild(frame)
      this.frame = frame
    })
    return this.ready
  }

  /** Fail every render in flight and drop the frame; the next render starts a new one. */
  private reset(error: Error) {
    if (this.listener) window.removeEventListener('message', this.listener)
    this.frame?.remove()
    this.frame = null
    this.ready = null
    this.listener = null
    const waiters = [...this.waiting.values()]
    this.waiting.clear()
    for (const w of waiters) w.reject(error)
  }

  /** Render jobs (cached by template and context). Rejects with TemplateTimeoutError if the frame stops answering. */
  async render(jobs: TemplateJob[]): Promise<TemplateResult[]> {
    const keys = jobs.map((j) => JSON.stringify([j.tpl, j.ctx]))
    const missing = jobs.filter((_, i) => !this.cache.has(keys[i]))
    if (missing.length > 0) {
      const results = await this.withTimeout(async (id) => {
        await this.start()
        return new Promise<TemplateResult[]>((resolve, reject) => {
          this.waiting.set(id, { resolve, reject })
          this.frame!.contentWindow!.postMessage({ id, jobs: missing }, '*')
        })
      })
      missing.forEach((job, i) => {
        if (this.cache.size > 5000) this.cache.clear()
        this.cache.set(JSON.stringify([job.tpl, job.ctx]), results[i])
      })
    }
    return keys.map((k) => this.cache.get(k)!)
  }

  private withTimeout(fn: (id: number) => Promise<TemplateResult[]>): Promise<TemplateResult[]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      // Covers the frame loading too: a frame that never says it's ready is as stuck as one that never answers.
      const timer = setTimeout(() => {
        // Reject this render even if it was still waiting for the frame to load (it isn't in `waiting` yet).
        reject(new TemplateTimeoutError())
        this.reset(new TemplateTimeoutError())
      }, this.timeoutMs)
      fn(id).then(
        (results) => {
          clearTimeout(timer)
          resolve(results)
        },
        (error: Error) => {
          clearTimeout(timer)
          reject(error)
        }
      )
    })
  }
}

export const templates = new TemplateEngine()

/** What a render that timed out shows, one per job. */
const timedOut = (jobs: TemplateJob[]): TemplateResult[] => jobs.map(() => ({ ok: false, error: 'Template took too long' }))

/** Render templates; null until the first batch is back. */
export function useTemplates(jobs: TemplateJob[]): TemplateResult[] | null {
  const key = useMemo(() => JSON.stringify(jobs), [jobs])
  const [state, setState] = useState<{ key: string; results: TemplateResult[] } | null>(null)
  // The effect re-runs when the content changes (the key), not on every new array.
  const latest = useRef(jobs)
  useLayoutEffect(() => {
    latest.current = jobs
  })
  useEffect(() => {
    let live = true
    const batch = latest.current
    if (batch.length === 0) {
      setState({ key, results: [] })
      return
    }
    templates.render(batch).then(
      (results) => {
        if (live) setState({ key, results })
      },
      () => {
        if (live) setState({ key, results: timedOut(batch) })
      }
    )
    return () => {
      live = false
    }
  }, [key])
  // Keep showing the previous results while a new batch renders.
  return state ? state.results : null
}
