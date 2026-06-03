import { configDefaults, defineConfig } from 'vitest/config'
import { existsSync, readdirSync } from 'node:fs'
import { availableParallelism, totalmem } from 'node:os'
import { createRequire } from 'node:module'
import path from 'path'

const require = createRequire(import.meta.url)

// Worker concurrency derived from the HOST, not a magic constant — the same
// config is fast on the 64c/188GB devbox and safe on a small CI runner, with no
// box-specific number to go stale (the prior hardcoded `4` was calibrated for a
// decommissioned 14c/15GB box). Mirrors the memory-aware ceiling in
// packages/measures/src/_runners/capture-ci-checks.ts. The cap is the MIN of:
//   • CPU knee — half the logical cores. Measured on the 64c/188GB devbox the
//     full unit suite is 4f→208s, 16f→69s, 32f→64s, 64f→77s: past ~cores/2 the
//     shared transform/collect phase thrashes and wall time REGRESSES (and
//     timer-based tests flake more), so more forks is actively worse, not just
//     wasteful.
//   • RAM budget — 75% of total memory at ~1.5 GB/fork (measured peak). On a
//     4c/16GB runner this binds first (→2 forks, ~3 GB) so we never reproduce
//     the OOM cascade that reaped systemd on the old box.
const PER_FORK_GB = 1.5
const MEMORY_UTILISATION = 0.75
const cpuCeiling = Math.max(1, Math.floor(availableParallelism() / 2))
const memCeiling = Math.max(1, Math.floor((totalmem() / 1024 ** 3 * MEMORY_UTILISATION) / PER_FORK_GB))
const maxWorkers = Math.min(cpuCeiling, memCeiling)
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
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: maxWorkers },
      threads: { maxThreads: maxWorkers },
    },
    // Codebase-health tests parse the whole repo and can exceed the default 5s
    // budget under parallel-worker CPU contention.
    testTimeout: 30_000,
    exclude: isRunningInsideWorktree
      ? [...configDefaults.exclude, ...sharedExclude, ...nestedGitRootExcludes(repoRoot)]
      : [...configDefaults.exclude, ...sharedExclude, '**/.worktrees/**', ...nestedGitRootExcludes(repoRoot)],
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
