import type { KnipConfig } from 'knip'

const config: KnipConfig = {
    workspaces: {
        '.': {
            entry: [
                '.claude/hooks/**/*.cjs',
                '.codex/hooks/**/*.cjs',
                'scripts/*.mjs',
                'scripts/*.cjs',
                'infra/perf-stack/scripts/*.mjs',
                'packages/measures/**/*.ts',
                'packages/systems/agent-runtime/bin/*.ts',
                'health-dashboard/app.js',
                'perf-dashboard/server.mjs',
                'perf-dashboard/app.js',
                'vitest.config.fuzz.ts',
            ],
            ignore: [
                'brain/**',
                'vt-website-quartz/**',
                'voicetree-evals/**',
                'tools/**',
                '.venv-server/**',
                'health-dashboard/mockups/**',
                // Gitignored vendored/runtime data under the perf stack (Grafana's
                // own source under bin/grafana-home, Tempo WAL under storage/). Knip
                // does not honor the nested infra/perf-stack/.gitignore, so it would
                // otherwise report unused exports in third-party Grafana .tsx files
                // whenever the devbox has the stack vendored. Not our code to analyze.
                'infra/perf-stack/bin/**',
                'infra/perf-stack/storage/**',
            ],
        },
        'webapp': {
            entry: [
                'vite.web.config.ts',
                'src/utils/empty-node-module.ts',
                'src/utils/types/*.d.ts',
                // Sidecar type declaration for the vendored ctxmenu.js (imported as
                // ctxmenu.js + via window.ctxmenu). Knip tracks the .js import, not the
                // co-located .d.ts, so without this it false-flags the file as unused.
                'src/shell/UI/lib/ctxmenu.d.ts',
                'src/web-main.tsx',
                'src/shell/edge/main/runtime/electron/app/main.ts',
                'src/shell/edge/main/runtime/electron/app/preload.ts',
                'src/**/*.test.{ts,tsx}',
            ],
            project: ['src/**/*.{ts,tsx}'],
            ignore: [
                'e2e-tests/**',
            ],
        },
        'packages/measures': {
            entry: ['src/**/*.ts', 'src/**/*.test.ts'],
            project: ['src/**/*.ts'],
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
