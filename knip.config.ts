import type { KnipConfig } from 'knip'

const config: KnipConfig = {
    workspaces: {
        '.': {
            entry: [
                'scripts/*.mjs',
                'vitest.config.ts',
                'packages/systems/*.test.ts',
            ],
            ignore: [
                'brain/**',
                'vt-website-quartz/**',
                'voicetree-evals/**',
                'old/**',
                'tools/**',
                '.venv-server/**',
            ],
        },
        'webapp': {
            entry: [
                'src/web-main.tsx',
                'src/shell/edge/main/electron/main.ts',
                'src/shell/edge/main/electron/preload.ts',
                'src/shell/edge/main/cli/**/*.ts',
                'src/shell/edge/main/mcp-server/**/*.ts',
            ],
            project: ['src/**/*.{ts,tsx}'],
            ignore: [
                'e2e-tests/**',
            ],
        },
        'packages/libraries/*': {
            project: ['src/**/*.ts'],
        },
        'packages/systems/*': {
            entry: ['bin/*.ts'],
            project: ['src/**/*.ts'],
        },
    },
    exclude: ['duplicates'],
    ignoreExportsUsedInFile: true,
    ignoreDependencies: [
        '@electron/rebuild',
    ],
}

export default config
