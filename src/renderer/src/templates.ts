// Renders Jinja-style (Nunjucks) templates in a sandboxed iframe: the main UI's
// CSP forbids eval, which Nunjucks needs, so templates run in their own
// opaque-origin frame (public/sandbox) and results come back by postMessage.
import { useEffect, useMemo, useState } from 'react'
import type { TemplateContext } from '@shared/fields'

export interface TemplateJob {
  tpl: string
  ctx: TemplateContext
}

export type TemplateResult = { ok: true; value: string } | { ok: false; error: string }

class TemplateEngine {
  private frame: HTMLIFrameElement | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private readonly waiting = new Map<number, (results: TemplateResult[]) => void>()
  private readonly cache = new Map<string, TemplateResult>()

  private start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise((resolve) => {
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.setAttribute('aria-hidden', 'true')
      frame.tabIndex = -1
      frame.style.display = 'none'
      frame.src = new URL('sandbox/index.html', document.baseURI).toString()
      window.addEventListener('message', (event) => {
        if (event.source !== frame.contentWindow) return
        const data = event.data as { ready?: boolean; id?: number; results?: TemplateResult[] }
        if (data.ready) resolve()
        if (typeof data.id === 'number' && data.results) {
          this.waiting.get(data.id)?.(data.results)
          this.waiting.delete(data.id)
        }
      })
      document.body.appendChild(frame)
      this.frame = frame
    })
    return this.ready
  }

  async render(jobs: TemplateJob[]): Promise<TemplateResult[]> {
    const keys = jobs.map((j) => JSON.stringify([j.tpl, j.ctx]))
    const missing = jobs.filter((_, i) => !this.cache.has(keys[i]))
    if (missing.length > 0) {
      await this.start()
      const id = this.nextId++
      const results = await new Promise<TemplateResult[]>((resolve) => {
        this.waiting.set(id, resolve)
        this.frame!.contentWindow!.postMessage({ id, jobs: missing }, '*')
      })
      missing.forEach((job, i) => {
        if (this.cache.size > 5000) this.cache.clear()
        this.cache.set(JSON.stringify([job.tpl, job.ctx]), results[i])
      })
    }
    return keys.map((k) => this.cache.get(k)!)
  }
}

export const templates = new TemplateEngine()

/** Render templates; null until the first batch is back. */
export function useTemplates(jobs: TemplateJob[]): TemplateResult[] | null {
  const key = useMemo(() => JSON.stringify(jobs), [jobs])
  const [state, setState] = useState<{ key: string; results: TemplateResult[] } | null>(null)
  useEffect(() => {
    let live = true
    if (jobs.length === 0) {
      setState({ key, results: [] })
      return
    }
    void templates.render(jobs).then((results) => {
      if (live) setState({ key, results })
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  // Keep showing the previous results while a new batch renders.
  return state ? state.results : null
}
