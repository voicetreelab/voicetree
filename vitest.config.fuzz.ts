import { defineConfig } from 'vitest/config'
import path from 'path'

const ciCheckReporter = path.resolve(__dirname, 'packages/systems/_vitest-ci-check-reporter.ts')

type FuzzCheckCfg = { readonly checkId: string; readonly checkName: string; readonly command: string }

const fuzzChecks: ReadonlyArray<{ readonly fileNeedle: string; readonly cfg: FuzzCheckCfg }> = [
  {
    fileNeedle: 'invariants.fuzz.test.ts',
    cfg: {
      checkId: 'fuzz-graph-state-invariants',
      checkName: 'Fuzz: graph-state invariants',
      command: 'npm run test:fuzz -- packages/libraries/graph-state/tests/invariants.fuzz.test.ts',
    },
  },
  {
    fileNeedle: 'graph-delta.fuzz.test.ts',
    cfg: {
      checkId: 'fuzz-graph-delta',
      checkName: 'Fuzz: graph delta HTTP API',
      command: 'npm run test:fuzz -- packages/systems/graph-db-server/tests/graph-delta.fuzz.test.ts',
    },
  },
  {
    fileNeedle: 'session-state.fuzz.test.ts',
    cfg: {
      checkId: 'fuzz-session-state',
      checkName: 'Fuzz: session state',
      command: 'npm run test:fuzz -- packages/systems/graph-db-server/tests/session-state.fuzz.test.ts',
    },
  },
  {
    fileNeedle: 'system-lifecycle.fuzz.test.ts',
    cfg: {
      checkId: 'fuzz-system-lifecycle',
      checkName: 'Fuzz: system lifecycle',
      command: 'npm run test:fuzz -- packages/systems/graph-db-server/tests/system-lifecycle.fuzz.test.ts',
    },
  },
  {
    fileNeedle: 'EditorSync.fuzz.test.ts',
    cfg: {
      checkId: 'fuzz-editor-sync',
      checkName: 'Fuzz: editor sync',
      command: 'npm run test:fuzz -- webapp/src/shell/edge/UI-edge/floating-windows/editors/EditorSync.fuzz.test.ts',
    },
  },
]

const matched = fuzzChecks.find(({ fileNeedle }) => process.argv.some(arg => arg.includes(fileNeedle)))

const ciCheck: FuzzCheckCfg = matched
  ? matched.cfg
  : { checkId: 'fuzz-all', checkName: 'Fuzz: all systems', command: 'npm run test:fuzz' }

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'webapp/src'),
      '@root': path.resolve(__dirname, 'webapp'),
    },
  },
  test: {
    reporters: [
      'default',
      [ciCheckReporter, ciCheck],
    ],
    include: ['**/*.fuzz.test.ts'],
    exclude: ['**/node_modules/**', '**/.worktrees/**'],
  },
})
