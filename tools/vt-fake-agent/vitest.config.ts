import {defineConfig} from 'vitest/config'

// Standalone vitest config — overrides the root config's
// `exclude: ['**/tools/**']` so this package's own unit tests run.
// Intended to be invoked from inside tools/vt-fake-agent:
//   cd tools/vt-fake-agent && npx vitest run
export default defineConfig({
    test: {
        root: __dirname,
        include: ['src/**/*.test.ts'],
        exclude: ['node_modules/**', 'dist/**'],
    },
})
