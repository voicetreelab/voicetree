// Shared vite alias config for browser-only mockups using the harness.
//
// The harness runs the REAL VoiceTree renderer end-to-end:
//   chevron tap → real folderCollapse.ts
//               → window.hostAPI.main.setFolderStateThroughDaemon (browser stub)
//               → in-browser daemon runs real project() from @vt/graph-state
//               → real applyGraphDeltaToUI mutates cy
//   hover node  → real setupCommandHover → real createFloatingEditor
//               → real CodeMirrorEditorView (CodeMirror 6)
//               → window.hostAPI.main.getGraph/getNode/loadSettings stubs
//   edit text   → real modifyNodeContentFromFloatingEditor
//               → applyGraphDeltaToDB* (no-op — read-only playground)
//
// To make that resolvable in a browser without Electron/posthog fully booted,
// we alias a small set of LEAF modules to no-op shims. The folder-node and
// floating-editor pipelines run verbatim from `webapp/src`.

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
    const stubsDir: string = path.resolve(harnessDir, 'playground', 'stubs')
    const webappSrc: string = path.resolve(mockupDir, '..', '..', 'src')
    return [
        // Image viewers stay stubbed (playground scope — keeps the spatial-
        // index + anchor-to-node + readImageAsDataUrl IPC out of the bundle).
        // The real FloatingEditorCRUD now loads, so HoverEditor's import of
        // `openHoverImageViewer` resolves to a no-op here.
        {
            find: '@/shell/edge/UI-edge/floating-windows/image-viewers/FloatingImageViewerCRUD',
            replacement: path.resolve(stubsDir, 'floatingImageViewerCrud.ts'),
        },
        // Terminal-anchored windows aren't part of the playground. Anchor-to-
        // node is only reached from terminal/image viewer code paths.
        {
            find: '@/shell/edge/UI-edge/floating-windows/anchoring/anchor-to-node',
            replacement: path.resolve(stubsDir, 'anchorToNode.ts'),
        },
        {
            find: '@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity',
            replacement: path.resolve(stubsDir, 'agentTabsActivity.ts'),
        },
        // Engagement-prompts dereferences settings.userEmail; the renderer's
        // production wiring guards on real settings, the playground doesn't
        // run that subscription so the alias just removes the dead weight.
        {
            find: '@/shell/edge/UI-edge/graph/popups/userEngagementPrompts',
            replacement: path.resolve(stubsDir, 'userEngagementPrompts.ts'),
        },
        // @/... resolves to the real webapp src tree so every NON-stubbed
        // module above this line loads verbatim.
        { find: /^@(?=\/)/, replacement: webappSrc },
    ]
}
