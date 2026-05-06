import { configDefaults, defineConfig } from 'vitest/config'

const pathSegments = process.cwd().split(/[\\/]+/)
const isRunningInsideWorktree = pathSegments.includes('.worktrees')
const sharedExclude = [
  '**/*.spec.ts',
  '**/e2e-tests/**',
  '**/vt-website-quartz/**',
  '**/voicetree-evals/**',
  '**/tools/**',
  '**/brain/automation/**',
]

export default defineConfig({
  test: {
    exclude: isRunningInsideWorktree
      ? [...configDefaults.exclude, ...sharedExclude]
      : [...configDefaults.exclude, ...sharedExclude, '**/.worktrees/**'],
  },
})
