import {defineConfig} from 'vitest/config'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const ciCheckReporter = require.resolve('@vt/measures/vitest-reporter')

export default defineConfig({
    test: {
        // Reap tmux servers leaked by crashed prior workers and tear down this
        // worker's ephemeral tmux server on completion. See vitest.setup.ts.
        setupFiles: ['./vitest.setup.ts'],
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
