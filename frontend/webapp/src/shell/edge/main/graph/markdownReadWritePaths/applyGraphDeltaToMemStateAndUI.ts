import type {GraphDelta, Graph} from "@/pure/graph";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {applyGraphDeltaToGraph} from "@/pure/graph";
import {getMainWindow} from "@/shell/edge/main/state/app-electron-state";

/**
 * Apply a GraphDelta to in-memory state only.
 * Does NOT broadcast to UI - caller must explicitly call broadcastGraphDelta if needed.
 */
export function applyGraphDeltaToMemState(delta: GraphDelta): void {
    const currentGraph: Graph = getGraph();
    const newGraph: Graph = applyGraphDeltaToGraph(currentGraph, delta);
    setGraph(newGraph);
}

/**
 * Broadcast a GraphDelta to the renderer process.
 * This triggers graph UI updates (cytoscape) and floating editor updates.
 *
 * Explicit broadcasting makes data flow clearer:
 * - Editor path: broadcasts for graph UI updates, but renderer skips updateFloatingEditors for own changes
 * - FS event path: broadcasts for both graph UI and editor updates
 * - UI action path: broadcasts for graph UI, editors updated directly
 */
export function broadcastGraphDelta(delta: GraphDelta): void {
    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) return;
    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }
}
