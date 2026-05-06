import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'webapp/src'),
      '@root': path.resolve(__dirname, 'webapp'),
    },
  },
  test: {
    include: ['**/*.fuzz.test.ts'],
    exclude: ['**/node_modules/**', '**/.worktrees/**'],
  },
})
