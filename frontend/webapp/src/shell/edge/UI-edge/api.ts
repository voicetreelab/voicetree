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
// import {applyGraphDeltaToUI as applyGraphDeltaToUICore} from "@/shell/edge/UI-edge/graph/applyGraphDeltaToUI";
// import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
// import type {GraphDelta} from "@/pure/graph";
// import type {Core} from "cytoscape";

/**
 * Apply a graph delta to the UI (Cytoscape)
 * Wrapper that gets cy instance and calls the core function
 */
// function applyGraphDeltaToUI(delta: GraphDelta): void {
//     const cy: Core = getCyInstance();
//     applyGraphDeltaToUICore(cy, delta);
// }

// Export as object (like mainAPI)
// eslint-disable-next-line @typescript-eslint/typedef
export const uiAPI = {
    launchTerminalOntoUI,
    // applyGraphDeltaToUI,
};

export type UIAPIType = typeof uiAPI;
