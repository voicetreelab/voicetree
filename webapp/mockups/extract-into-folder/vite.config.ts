import { defineConfig } from 'vite'
import path from 'path'

// Standalone vite config — kept independent of webapp/vite.config.ts so the mockup
// doesn't drag in React/Tailwind/wasm plugins that the popup doesn't need.
// The popup itself has zero internal imports, but we still expose the `@` alias
// so the entry can use `@/shell/...` like real webapp code.
export default defineConfig({
    root: __dirname,
    resolve: {
        alias: [
            { find: /^@(?=\/)/, replacement: path.resolve(__dirname, '../../src') },
        ],
    },
    server: {
        port: 5174,
        strictPort: false,
    },
})
