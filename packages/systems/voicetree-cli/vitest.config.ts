import {defineConfig} from 'vitest/config'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const ciCheckReporter = require.resolve('@vt/measures/vitest-reporter')

export default defineConfig({
    test: {
        reporters: [
            'default',
            [ciCheckReporter, {
                checkId: 'voicetree-cli-unit',
                checkName: 'VoiceTree CLI Unit',
                command: 'npm --workspace @voicetree/cli run test',
            }],
        ],
    },
})
