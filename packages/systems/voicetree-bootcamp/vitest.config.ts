import {defineConfig} from 'vitest/config'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const ciCheckReporter = require.resolve('@vt/measures/vitest-reporter')

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
        reporters: [
            'default',
            [ciCheckReporter, {
                checkId: 'voicetree-bootcamp-unit',
                checkName: 'VoiceTree Bootcamp Unit',
                command: 'npm --workspace @vt/voicetree-bootcamp run test',
            }],
        ],
    },
})
