// Shared vite alias config for browser-only mockups using the harness.
//
// Aliases:
//   - `@/...`               → real webapp src tree, so FolderHandleService.ts +
//                              defaultNodeStyles.ts + themeColors.ts load verbatim.
//   - `folderCollapse` stub → replaces the real module (which pulls posthog +
//                              terminal stores + floating editors via
//                              applyGraphDeltaToUI). The stub mutates cy directly.
//
// Usage:
//   import { defineConfig } from 'vite'
//   import { getHarnessViteAliases } from '../_harness/viteAliases'
//   export default defineConfig({
//       root: __dirname,
//       resolve: { alias: getHarnessViteAliases(__dirname) },
//       server: { port: 5175, strictPort: false },
//   })

import path from 'path'

export interface ViteAliasEntry {
    find: string | RegExp
    replacement: string
}

/**
 * Build the vite alias array a browser-only mockup needs to consume the
 * harness. Pass the mockup's __dirname (where its vite.config.ts lives).
 */
export function getHarnessViteAliases(mockupDir: string): ViteAliasEntry[] {
    const harnessDir: string = path.resolve(mockupDir, '..', '_harness')
    const webappSrc: string = path.resolve(mockupDir, '..', '..', 'src')
    return [
        {
            find: '@/shell/edge/UI-edge/graph/view/folderCollapse',
            replacement: path.resolve(harnessDir, 'folderCollapseStub.ts'),
        },
        { find: /^@(?=\/)/, replacement: webappSrc },
    ]
}
