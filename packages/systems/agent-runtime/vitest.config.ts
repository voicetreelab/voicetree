import {defineConfig} from 'vitest/config'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const ciCheckReporter = require.resolve('@vt/ci-reporting/vitest-reporter')

export default defineConfig({
    test: {
        reporters: [
            'default',
            [ciCheckReporter, {
                checkId: 'agent-runtime-unit',
                checkName: 'Agent Runtime Unit',
                command: 'npm --workspace @vt/agent-runtime run test',
            }],
        ],
    },
})
