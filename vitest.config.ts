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
const ciCheckReporter = path.resolve(__dirname, 'packages/systems/_vitest-ci-check-reporter.ts')
const isOrangeGate = process.argv.some(arg =>
  arg.includes('hierarchical-complexity.test.ts')
  || arg.includes('behavioral-complexity.test.ts')
  || arg.includes('shape-complexity.test.ts'))
const ciCheck = isOrangeGate
  ? {
      checkId: 'orange-gate',
      checkName: 'Orange Complexity Gate',
      command: 'npm run orange-codebase-complexity-tests',
    }
  : {
      checkId: 'systems-health',
      checkName: 'Systems Health Suite',
      command: 'npm run test:codebase-health',
    }

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
    reporters: [
      'default',
      [ciCheckReporter, ciCheck],
    ],
    // Codebase-health tests parse the whole repo and can exceed the default 5s
    // budget under parallel-worker CPU contention.
    testTimeout: 30_000,
    exclude: isRunningInsideWorktree
      ? [...configDefaults.exclude, ...sharedExclude]
      : [...configDefaults.exclude, ...sharedExclude, '**/.worktrees/**'],
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
