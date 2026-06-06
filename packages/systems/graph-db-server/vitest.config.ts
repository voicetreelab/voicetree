import { defineConfig } from 'vitest/config'
import path from 'node:path'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const ciCheckReporter = require.resolve('@vt/measures/vitest-reporter')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@vt\/graph-model$/, replacement: path.resolve(__dirname, '../../libraries/graph-model/src/index.ts') },
      { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(__dirname, '../../libraries/graph-model/src/$1') },
    ],
  },
  test: {
    reporters: [
      'default',
      [ciCheckReporter, {
        checkId: 'graph-db-server-unit',
        checkName: 'Graph DB Server Unit',
        command: 'npm --workspace @vt/graph-db-server run test',
      }],
    ],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 4 },
    },
    testTimeout: 30_000,
  },
})
