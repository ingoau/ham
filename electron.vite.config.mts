import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Ships nunjucks' browser build next to the template sandbox (public/sandbox). */
function nunjucksSandbox(): Plugin {
  const file = createRequire(import.meta.url).resolve('nunjucks/browser/nunjucks.min.js')
  return {
    name: 'ham-nunjucks-sandbox',
    configureServer(server) {
      server.middlewares.use('/sandbox/nunjucks.min.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sandbox/nunjucks.min.js', source: readFileSync(file) })
    }
  }
}

// devDependencies are bundled; `dependencies` (imapflow) stay external and ship
// in the packaged app's node_modules.
export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { outDir: 'out/main' }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), nunjucksSandbox()],
    build: { outDir: 'out/renderer' }
  }
})
