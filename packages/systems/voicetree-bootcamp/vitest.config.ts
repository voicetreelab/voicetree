import {defineConfig} from 'vitest/config'
import {fileURLToPath} from 'node:url'

const ciCheckReporter = fileURLToPath(new URL('../_vitest-ci-check-reporter.ts', import.meta.url))

export default defineConfig({
    test: {
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
