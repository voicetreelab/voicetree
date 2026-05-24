import {defineConfig} from 'vitest/config'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const ciCheckReporter = require.resolve('@vt/measures/vitest-reporter')

export default defineConfig({
    test: {
        reporters: [
            'default',
            [ciCheckReporter, {
                checkId: 'vt-daemon-unit',
                checkName: 'vt-daemon Unit',
                command: 'npm --workspace @vt/vt-daemon run test',
            }],
        ],
    },
})
