export const PROJECTION_SEAM_PATTERNS: readonly string[] = [
    'webapp/src/shell/UI/**',
    'webapp/src/shell/web/**',
    'webapp/src/utils/responsivePadding.ts',
    'webapp/src/utils/visibleViewport.ts',
    'webapp/src/utils/viewportVisibility.ts',
    // [L2-audit-exempt] Renderer-side projection consumers — cy.* calls here are
    // architecturally correct (delta → cy), not authoritative state.
    'webapp/src/shell/edge/UI-edge/graph/layoutProjection.ts',
    'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
    'webapp/src/shell/edge/UI-edge/graph/setupViewSubscriptions.ts',
    'webapp/src/shell/edge/UI-edge/graph/folderCollapse.ts',
] as const

function isTestScaffolding(relativePath: string): boolean {
    return (
        relativePath.includes('/__tests__/')
        || relativePath.includes('/integration-tests/')
        || relativePath.includes('/test-utils/')
    )
}

export function isProjectionSeam(relativePath: string): boolean {
    return (
        relativePath.startsWith('webapp/src/shell/UI/')
        || relativePath.startsWith('webapp/src/shell/web/')
        || relativePath === 'webapp/src/utils/responsivePadding.ts'
        || relativePath === 'webapp/src/utils/visibleViewport.ts'
        || relativePath === 'webapp/src/utils/viewportVisibility.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/graph/applyLiveCommandToRenderer.ts'
        // [L2-audit-exempt] Renderer-side projection consumers — cy.* here is
        // architecturally correct (delta → cy), not authoritative state.
        || relativePath === 'webapp/src/shell/edge/UI-edge/graph/layoutProjection.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/graph/setupViewSubscriptions.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/graph/folderCollapse.ts'
        // [L2-audit-exempt-2] Shadow-node / cy-only decoration surfaces — no graph-state equivalent.
        // Shadow nodes are cytoscape-only renderer concepts (floating-window anchors).
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/anchor-to-node.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/extractObstaclesFromCytoscape.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/select-floating-window-node.ts'
        // [L2-BF-179] Editor/viewer/floating-window residuals — all remaining cy.* are shadow-node, decoration, or viewport-only.
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/editors/HoverEditor.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/editors/AnchoredEditor.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/image-viewers/FloatingImageViewerCRUD.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/headless-badge-overlay.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/create-window-chrome.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/setup-resize-observer.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/update-window-from-zoom.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/terminals/closeTerminal.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/floating-windows/terminals/createFloatingTerminal.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/graph/navigation/GraphNavigationService.ts'
        || isTestScaffolding(relativePath)
    )
}
