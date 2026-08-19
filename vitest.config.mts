import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` -> `./*` mapping in tsconfig.json so a test imports a
    // module by the same specifier the app uses.
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // Tests cover pure logic that runs on the server; no DOM is needed.
    environment: 'node',
    // Tests live next to the code they cover.
    include: ['lib/**/*.test.ts'],
  },
})
