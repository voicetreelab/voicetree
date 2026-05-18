import { defineConfig } from 'vitest/config'
import {fileURLToPath} from 'node:url'

const ciCheckReporter = fileURLToPath(new URL('../../systems/_vitest-ci-check-reporter.ts', import.meta.url))

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
