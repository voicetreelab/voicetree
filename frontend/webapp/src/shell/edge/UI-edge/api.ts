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
import {updateFloatingEditors} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
import type {GraphDelta} from "@/pure/graph";
import type {Core} from "cytoscape";

/**
 * Update floating editors from external FS changes
 * Called from main process read path when external edits are detected
 */
function updateFloatingEditorsFromExternal(delta: GraphDelta): void {
    const cy: Core = getCyInstance();
    updateFloatingEditors(cy, delta);
}

// Export as object (like mainAPI)
// eslint-disable-next-line @typescript-eslint/typedef
export const uiAPI = {
    launchTerminalOntoUI,
    updateFloatingEditorsFromExternal,
};

export type UIAPIType = typeof uiAPI;
