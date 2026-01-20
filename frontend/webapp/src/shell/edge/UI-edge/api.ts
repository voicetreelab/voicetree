/**
 * UI API - Functions callable from main process via IPC
 *
 * This mirrors the mainAPI pattern: main process can call these functions
 * using the uiAPI proxy, which sends IPC messages that are handled here.
 *
 * Pattern:
 * - Main: uiAPI.launchTerminalOntoUI(nodeId, data)  // typed proxy
 * - IPC: 'ui:call' with funcName and args
 * - Renderer: uiAPI[funcName](...args)  // actual implementation
 */

import {launchTerminalOntoUI} from "@/shell/edge/UI-edge/launchTerminalOntoUI";
import {updateFloatingEditors, createAnchoredFloatingEditor} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
import {getResponsivePadding} from "@/utils/responsivePadding";
import type {GraphDelta, NodeIdAndFilePath} from "@/pure/graph";
import {isImageNode} from "@/pure/graph";
import type {Core} from "cytoscape";

/**
 * Update floating editors from external FS changes
 * Called from main process read path when external edits are detected
 */
function updateFloatingEditorsFromExternal(delta: GraphDelta): void {
    const cy: Core = getCyInstance();
    updateFloatingEditors(cy, delta);
}

/**
 * Create an editor for a node created by an external FS change.
 * This is the auto-pin path for truly external file additions.
 * Called from main process FS watcher when it detects a new file was added externally.
 */
function createEditorForExternalNode(nodeId: NodeIdAndFilePath): void {
    // Don't auto-open floating editor for image nodes
    if (isImageNode(nodeId)) {
        return;
    }
    const cy: Core = getCyInstance();
    void createAnchoredFloatingEditor(cy, nodeId, false, true);
}

/**
 * Fit viewport to remaining nodes after vault removal.
 * Called from main process when a vault path is removed from the allowlist.
 */
function fitViewport(): void {
    const cy: Core = getCyInstance();
    if (cy.nodes().length > 0) {
        cy.fit(undefined, getResponsivePadding(cy, 10));
    }
}

// Export as object (like mainAPI)
// eslint-disable-next-line @typescript-eslint/typedef
export const uiAPIHandler = {
    launchTerminalOntoUI,
    updateFloatingEditorsFromExternal,
    createEditorForExternalNode,
    fitViewport,
};

export type UIAPIType = typeof uiAPIHandler;
