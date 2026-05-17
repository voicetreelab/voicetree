import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['brain/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.worktrees/**'],
    testTimeout: 30_000,
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
