import { defineConfig } from 'vite'
import path from 'path'

// Standalone vite config for the folder-handle mockup.
//
// Aliases:
// - `@/...`               → real webapp src tree, so FolderHandleService.ts loads verbatim.
// - `folderCollapse` stub → replaces the real module (which pulls posthog +
//                            terminal stores + floating editors via
//                            applyGraphDeltaToUI). The stub mutates cy directly
//                            so the chevron's `toggleFolderCollapse` call works
//                            in a plain browser, no electron IPC needed.
export default defineConfig({
    root: __dirname,
    resolve: {
        alias: [
            {
                find: '@/shell/edge/UI-edge/graph/view/folderCollapse',
                replacement: path.resolve(__dirname, 'stubs/folderCollapse.ts'),
            },
            { find: /^@(?=\/)/, replacement: path.resolve(__dirname, '../../src') },
        ],
    },
    server: {
        port: 5175,
        strictPort: false,
    },
})
