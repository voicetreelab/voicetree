import { defineConfig } from 'vitest/config'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const ciCheckReporter = require.resolve('@vt/measures/vitest-reporter')

export default defineConfig({
  test: {
    reporters: [
      'default',
      [ciCheckReporter, {
        checkId: 'graph-model-unit',
        checkName: 'Graph Model Unit',
        command: 'npm --workspace @vt/graph-model run test',
      }],
    ],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
