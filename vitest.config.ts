import { configDefaults, defineConfig } from 'vitest/config'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'path'

const require = createRequire(import.meta.url)
// TODO: drop the .worktrees handling below once migrate-worktrees-to-sibling.sh
// has run and .worktrees/ is empty. Sibling vt-wts/ is outside the repo root,
// so vitest never walks into it.
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
  '**/brain/**',
  '**/native-modules/**',
  '**/workers/share-worker/**',
  'tests/system/**',
  'old/**',
]
const repoRoot = process.cwd()
const nestedGitRootExcludes = (root: string): string[] => {
  const excludedDirNames = new Set([
    'node_modules',
    '.git',
    'dist',
    'dist-electron',
    'out',
    'build',
    // TODO: drop post-migration; see comment above.
    '.worktrees',
  ])
  const found: string[] = []
  const readDirectories = (absDir: string) => {
    try {
      return readdirSync(absDir, { withFileTypes: true })
    } catch (error) {
      if (
        error instanceof Error
        && 'code' in error
        && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        return []
      }
      throw error
    }
  }
  const walk = (absDir: string, relDir: string) => {
    for (const entry of readDirectories(absDir)) {
      if (!entry.isDirectory()) continue
      if (excludedDirNames.has(entry.name)) continue
      const childAbs = path.join(absDir, entry.name)
      const childRel = relDir ? path.join(relDir, entry.name) : entry.name
      if (existsSync(path.join(childAbs, '.git'))) {
        found.push(`${childRel.split(path.sep).join('/')}/**`)
        continue
      }
      walk(childAbs, childRel)
    }
  }
  walk(root, '')
  return found
}
const ciCheckReporter = require.resolve('@vt/measures/vitest-reporter')
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
      command: 'npm run test:measures',
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
      ? [...configDefaults.exclude, ...sharedExclude, ...nestedGitRootExcludes(repoRoot)]
      : [...configDefaults.exclude, ...sharedExclude, '**/.worktrees/**', ...nestedGitRootExcludes(repoRoot)],
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
