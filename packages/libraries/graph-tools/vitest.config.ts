import { defineConfig } from 'vitest/config'
import {fileURLToPath} from 'node:url'

const ciCheckReporter = fileURLToPath(new URL('../../systems/_vitest-ci-check-reporter.ts', import.meta.url))

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
