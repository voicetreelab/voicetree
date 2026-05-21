import { defineConfig } from 'vitest/config'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const ciCheckReporter = require.resolve('@vt/ci-reporting/vitest-reporter')

export default defineConfig({
    test: {
        reporters: [
            'default',
            [ciCheckReporter, {
                checkId: 'graph-state-unit',
                checkName: 'Graph State Unit',
                command: 'npm --workspace @vt/graph-state run test',
            }],
        ],
        include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    },
})
