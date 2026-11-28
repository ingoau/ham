// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateEngine, TemplateTimeoutError, type TemplateJob, type TemplateResult } from '../../src/renderer/src/templates'

const job = (tpl: string): TemplateJob => ({ tpl, ctx: { index: 1, total: 1, current: '', account: {} as TemplateJob['ctx']['account'] } })
const frames = () => [...document.querySelectorAll('iframe')]

/** A message event from `source` (happy-dom doesn't load the frame, so the sandbox is played by hand). */
function message(source: unknown, data: unknown) {
  window.dispatchEvent(Object.assign(new Event('message'), { source, data }))
}

/** Play the sandbox: say ready, then answer each batch with `answer` (or never, if it returns null). */
function fakeSandbox(frame: HTMLIFrameElement, answer: (jobs: TemplateJob[]) => TemplateResult[] | null) {
  const win = {
    postMessage: (data: { id: number; jobs: TemplateJob[] }) => {
      const results = answer(data.jobs)
      if (results) message(win, { id: data.id, results })
    }
  }
  Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => win })
  message(win, { ready: true })
}

describe('TemplateEngine', () => {
  beforeEach(() => {
    // happy-dom doesn't load frame pages (and says so on the console): give the frame an empty srcdoc instead.
    const append = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      if (node instanceof HTMLIFrameElement) node.srcdoc = ''
      return append(node)
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
    for (const f of frames()) f.remove()
  })

  it('renders through the frame and caches results', async () => {
    const engine = new TemplateEngine(1000, () => '')
    const answer = vi.fn((jobs: TemplateJob[]) => jobs.map((j) => ({ ok: true as const, value: j.tpl.toUpperCase() })))
    const first = engine.render([job('a'), job('b')])
    await Promise.resolve()
    fakeSandbox(frames()[0], answer)
    expect(await first).toEqual([
      { ok: true, value: 'A' },
      { ok: true, value: 'B' }
    ])
    expect(await engine.render([job('b')])).toEqual([{ ok: true, value: 'B' }])
    expect(answer).toHaveBeenCalledTimes(1)
  })

  it('gives up on a render that never comes back and starts a new frame', async () => {
    vi.useFakeTimers()
    const engine = new TemplateEngine(2000, () => '')
    const stuck = engine.render([job('{% while true %}')])
    const failed = expect(stuck).rejects.toBeInstanceOf(TemplateTimeoutError)
    await vi.advanceTimersByTimeAsync(0)
    const [frame] = frames()
    fakeSandbox(frame, () => null)
    await vi.advanceTimersByTimeAsync(1999)
    expect(frame.isConnected).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await failed
    expect(frame.isConnected).toBe(false)

    // The next render gets a fresh frame.
    const next = engine.render([job('ok')])
    await vi.advanceTimersByTimeAsync(0)
    const fresh = frames()
    expect(fresh).toHaveLength(1)
    expect(fresh[0]).not.toBe(frame)
    fakeSandbox(fresh[0], (jobs) => jobs.map(() => ({ ok: true, value: 'fine' })))
    expect(await next).toEqual([{ ok: true, value: 'fine' }])
  })

  it('times out a frame that never loads, failing every waiting render', async () => {
    vi.useFakeTimers()
    const engine = new TemplateEngine(500, () => '')
    const a = expect(engine.render([job('a')])).rejects.toBeInstanceOf(TemplateTimeoutError)
    const b = expect(engine.render([job('b')])).rejects.toBeInstanceOf(TemplateTimeoutError)
    await vi.advanceTimersByTimeAsync(500)
    await a
    await b
    expect(frames()).toHaveLength(0)
  })
})

describe('useTemplates', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('shows an error per job when the render times out', async () => {
    const mod = await import('../../src/renderer/src/templates')
    vi.spyOn(mod.templates, 'render').mockRejectedValue(new mod.TemplateTimeoutError())
    const { result } = renderHook(() => mod.useTemplates([job('a'), job('b')]))
    await act(async () => {})
    expect(result.current).toEqual([
      { ok: false, error: 'Template took too long' },
      { ok: false, error: 'Template took too long' }
    ])
  })

  it('renders nothing for no jobs', async () => {
    const mod = await import('../../src/renderer/src/templates')
    const render = vi.spyOn(mod.templates, 'render')
    const { result } = renderHook(() => mod.useTemplates([]))
    await act(async () => {})
    expect(result.current).toEqual([])
    expect(render).not.toHaveBeenCalled()
  })
})
