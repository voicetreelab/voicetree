import { defineConfig } from 'vitest/config'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const ciCheckReporter = require.resolve('@vt/measures/vitest-reporter')

export default defineConfig({
  test: {
    reporters: [
      'default',
      [ciCheckReporter, {
        checkId: 'graph-tools-unit',
        checkName: 'Graph Tools Unit',
        command: 'npm --workspace @vt/graph-tools run test',
      }],
    ],
    include: ['tests/**/*.test.ts'],
  },
})
