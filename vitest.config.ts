import { configDefaults, defineConfig } from 'vitest/config'

const pathSegments = process.cwd().split(/[\\/]+/)
const isRunningInsideWorktree = pathSegments.includes('.worktrees')

export default defineConfig({
  test: {
    exclude: isRunningInsideWorktree
      ? configDefaults.exclude
      : [...configDefaults.exclude, '**/.worktrees/**'],
  },
})
