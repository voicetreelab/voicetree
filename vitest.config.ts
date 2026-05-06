import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'

const pathSegments = process.cwd().split(/[\\/]+/)
const isRunningInsideWorktree = pathSegments.includes('.worktrees')
const sharedExclude = [
  '**/*.spec.ts',
  '**/*.fuzz.test.ts',
  '**/e2e-tests/**',
  '**/vt-website-quartz/**',
  '**/voicetree-evals/**',
  '**/tools/**',
  '**/brain/automation/**',
  '**/native-modules/**',
  '**/workers/share-worker/**',
  'tests/system/**',
]

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'webapp/src'),
      '@root': path.resolve(__dirname, 'webapp'),
    },
  },
  test: {
    exclude: isRunningInsideWorktree
      ? [...configDefaults.exclude, ...sharedExclude]
      : [...configDefaults.exclude, ...sharedExclude, '**/.worktrees/**'],
  },
})
