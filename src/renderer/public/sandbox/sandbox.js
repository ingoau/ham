/* global nunjucks */
// Renders Jinja-style templates for the app. Messages in: { id, jobs: [{ tpl, ctx }] }.
// Messages out: { id, results: [{ ok, value } | { ok: false, error }] }.
;(function () {
  'use strict'
  var env = new nunjucks.Environment(null, { autoescape: false, throwOnUndefined: true })

  function clean(message) {
    return String(message || 'Template error')
      .replace(/^\(unknown path\)\s*/, '')
      .replace(/\[Line \d+, Column \d+\]\s*/g, '')
      .replace(/^\s*Error:\s*/m, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  window.addEventListener('message', function (event) {
    var data = event.data || {}
    if (typeof data.id !== 'number' || !Array.isArray(data.jobs)) return
    var results = data.jobs.map(function (job) {
      try {
        return { ok: true, value: env.renderString(String(job.tpl), job.ctx || {}) }
      } catch (err) {
        return { ok: false, error: clean(err && err.message) }
      }
    })
    event.source.postMessage({ id: data.id, results: results }, '*')
  })
  parent.postMessage({ ready: true }, '*')
})()
