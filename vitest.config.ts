import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    alias: {
      '@/': path.resolve(__dirname, 'apps/desktop/src/') + '/',
    },
  },
})
