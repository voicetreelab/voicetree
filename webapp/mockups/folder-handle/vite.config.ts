import { defineConfig } from 'vite'

import { getHarnessViteAliases } from '../_harness/viteAliases'

// All shared aliases (real webapp src + folderCollapse stub) come from the
// harness. See ../_harness/README.md.
export default defineConfig({
    root: __dirname,
    resolve: { alias: getHarnessViteAliases(__dirname) },
    server: {
        port: 5175,
        strictPort: false,
    },
})
