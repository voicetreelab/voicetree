import type { KnipConfig } from 'knip'

const config: KnipConfig = {
    workspaces: {
        '.': {
            entry: [
                'scripts/*.mjs',
                'scripts/*.cjs',
                'scripts/measures/**/*.ts',
                'health-dashboard/app.js',
                'vitest.config.fuzz.ts',
                'packages/systems/*.test.ts',
            ],
            ignore: [
                'brain/**',
                'vt-website-quartz/**',
                'voicetree-evals/**',
                'old/**',
                'tools/**',
                '.venv-server/**',
                'health-dashboard/mockups/**',
            ],
        },
        'webapp': {
            entry: [
                'vite.web.config.ts',
                'src/utils/empty-node-module.ts',
                'src/utils/types/*.d.ts',
                'src/web-main.tsx',
                'src/shell/edge/main/electron/main.ts',
                'src/shell/edge/main/electron/preload.ts',
                'src/shell/edge/main/cli/**/*.ts',
                'src/shell/edge/main/mcp-server/**/*.ts',
                'src/**/*.test.{ts,tsx}',
            ],
            project: ['src/**/*.{ts,tsx}'],
            ignore: [
                'e2e-tests/**',
            ],
        },
        'packages/libraries/*': {
            entry: ['bin/*.ts', 'scripts/*.ts', 'src/debug/buildBundles.ts', 'src/**/*.test.ts', 'tests/**/*.test.ts'],
            project: ['src/**/*.ts'],
        },
        'packages/systems/*': {
            entry: ['bin/*.ts', 'src/**/*.test.ts', 'tests/**/*.test.ts'],
            project: ['src/**/*.ts'],
        },
    },
    exclude: ['duplicates'],
    ignoreExportsUsedInFile: true,
    tags: ['-knipignore'],
}

export default config
