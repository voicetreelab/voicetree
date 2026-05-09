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
  '**/.node_modules-*/**',
  '**/tools/**',
  '**/brain/automation/**',
  '**/native-modules/**',
  '**/workers/share-worker/**',
  'tests/system/**',
  'old/**',
]

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@vt\/graph-model$/, replacement: path.resolve(__dirname, 'packages/libraries/graph-model/src/index.ts') },
      { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(__dirname, 'packages/libraries/graph-model/src/$1') },
      { find: /^@root(?=\/)/, replacement: path.resolve(__dirname, 'webapp') },
      { find: /^@(?=\/)/, replacement: path.resolve(__dirname, 'webapp/src') },
    ],
  },
  test: {
    exclude: isRunningInsideWorktree
      ? [...configDefaults.exclude, ...sharedExclude]
      : [...configDefaults.exclude, ...sharedExclude, '**/.worktrees/**'],
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
