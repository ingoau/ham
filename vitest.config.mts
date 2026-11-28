import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Node by default; component tests opt in to a DOM with `// @vitest-environment happy-dom`.
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' }
})
