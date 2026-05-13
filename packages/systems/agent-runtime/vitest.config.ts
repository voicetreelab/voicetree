import {defineConfig} from 'vitest/config'
import {fileURLToPath} from 'node:url'

const ciCheckReporter = fileURLToPath(new URL('../_vitest-ci-check-reporter.ts', import.meta.url))

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
