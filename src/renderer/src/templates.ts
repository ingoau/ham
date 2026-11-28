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

/** How long one chunk (or the frame loading) may take before the frame is thrown away. */
export const RENDER_TIMEOUT_MS = 2000
/**
 * Jobs per message to the frame. Chunks go one at a time, each with its own timeout, so a
 * long list (thousands of accounts × templates) never looks stuck, while one runaway
 * template still holds up its chunk past the timeout.
 */
export const CHUNK_SIZE = 200

export class TemplateTimeoutError extends Error {
  constructor() {
    super('Template took too long')
    this.name = 'TemplateTimeoutError'
  }
}

interface Chunk {
  id: number
  jobs: TemplateJob[]
  resolve(results: TemplateResult[]): void
  reject(error: Error): void
}

export class TemplateEngine {
  private frame: HTMLIFrameElement | null = null
  private ready = false
  private listener: ((event: MessageEvent) => void) | null = null
  /** Bumped by every reset: a timer only acts on the frame it was set for. */
  private generation = 0
  /** Covers the frame loading, then the chunk in flight. */
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Chunk | null = null
  private readonly queue: Chunk[] = []
  private nextId = 1
  private readonly cache = new Map<string, TemplateResult>()

  constructor(
    private readonly timeoutMs = RENDER_TIMEOUT_MS,
    private readonly src = () => new URL('sandbox/index.html', document.baseURI).toString(),
    private readonly chunkSize = CHUNK_SIZE
  ) {}

  private arm() {
    if (this.timer) clearTimeout(this.timer)
    const generation = this.generation
    this.timer = setTimeout(() => {
      if (generation === this.generation) this.reset(new TemplateTimeoutError())
    }, this.timeoutMs)
  }

  private disarm() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private start() {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.style.display = 'none'
    frame.src = this.src()
    this.listener = (event) => {
      if (event.source !== frame.contentWindow || frame !== this.frame) return
      const data = event.data as { ready?: boolean; id?: number; results?: TemplateResult[] }
      if (data.ready && !this.ready) {
        this.ready = true
        this.disarm()
        this.pump()
      }
      if (typeof data.id === 'number' && data.results && this.inFlight?.id === data.id) {
        const chunk = this.inFlight
        this.inFlight = null
        this.disarm()
        chunk.resolve(data.results)
        this.pump()
      }
    }
    window.addEventListener('message', this.listener)
    document.body.appendChild(frame)
    this.frame = frame
    // A frame that never says it's ready is as stuck as one that never answers.
    this.arm()
  }

  /** Send the next chunk once the frame is ready and free. */
  private pump() {
    if (this.inFlight || this.queue.length === 0) return
    if (!this.frame) return this.start()
    if (!this.ready) return
    const chunk = this.queue.shift()!
    this.inFlight = chunk
    this.arm()
    this.frame.contentWindow!.postMessage({ id: chunk.id, jobs: chunk.jobs }, '*')
  }

  /** Fail every outstanding render (sent or still queued) and drop the frame; the next render starts a new one. */
  private reset(error: Error) {
    this.generation++
    this.disarm()
    if (this.listener) window.removeEventListener('message', this.listener)
    this.frame?.remove()
    this.frame = null
    this.ready = false
    this.listener = null
    const failed = [...(this.inFlight ? [this.inFlight] : []), ...this.queue.splice(0)]
    this.inFlight = null
    for (const c of failed) c.reject(error)
  }

  /** Render jobs (cached by template and context). Rejects with TemplateTimeoutError if the frame stops answering. */
  async render(jobs: TemplateJob[]): Promise<TemplateResult[]> {
    const keys = jobs.map((j) => JSON.stringify([j.tpl, j.ctx]))
    // Read from the cache once: it may be cleared while this batch fills it.
    const found = new Map(keys.flatMap((k) => (this.cache.has(k) ? [[k, this.cache.get(k)!] as const] : [])))
    const missing = jobs.filter((_, i) => !found.has(keys[i]))
    if (missing.length > 0) {
      const chunks: Promise<TemplateResult[]>[] = []
      for (let i = 0; i < missing.length; i += this.chunkSize) {
        const part = missing.slice(i, i + this.chunkSize)
        chunks.push(new Promise((resolve, reject) => this.queue.push({ id: this.nextId++, jobs: part, resolve, reject })))
      }
      this.pump()
      const results = (await Promise.all(chunks)).flat()
      missing.forEach((job, i) => {
        const key = JSON.stringify([job.tpl, job.ctx])
        found.set(key, results[i])
        if (this.cache.size > 5000) this.cache.clear()
        this.cache.set(key, results[i])
      })
    }
    return keys.map((k) => found.get(k)!)
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
