import {defineConfig} from 'vitest/config'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const ciCheckReporter = require.resolve('@vt/measures/vitest-reporter')

export default defineConfig({
    test: {
        reporters: [
            'default',
            [ciCheckReporter, {
                checkId: 'voicetree-mcp-unit',
                checkName: 'VoiceTree MCP Unit',
                command: 'npm --workspace @vt/voicetree-mcp run test',
            }],
        ],
    },
})
