import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts', 'apps/gateway/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
