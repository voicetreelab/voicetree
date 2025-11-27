import type {FSEvent, GraphDelta, Graph} from "@/pure/graph";
import {mapFSEventsToGraphDelta} from "@/pure/graph";
import type {BrowserWindow} from "electron";
import {applyGraphDeltaToMemStateAndUI} from "@/shell/edge/main/graph/readAndDBEventsPath/applyGraphDeltaToMemStateAndUI";
import {getGraph} from "@/shell/edge/main/state/graph-store";

/**
 * Handle filesystem events by:
 * 1. Computing the GraphDelta from the filesystem event
 * 2. Applying delta to graph state
 * 3. Broadcasting delta to UI-edge
 *
 * This is the central handler that connects:
 * - Pure layer: mapFSEventsToGraphDelta
 * - State + UI-edge layer: applyGraphDeltaToMemStateAndUI
 *
 * @param fsEvent - Filesystem event (add, change, or delete)
 * @param vaultPath - Absolute path to vault
 * @param mainWindow - Electron window to send updates to
 */
export function handleFSEventWithStateAndUISides(
    fsEvent: FSEvent,
    vaultPath: string,
    mainWindow: BrowserWindow
): void {
    // 1. Get current graph state to resolve wikilinks
    const currentGraph: Graph = getGraph();

    // 2. Map filesystem event to graph delta (pure)
    const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, vaultPath, currentGraph);

    applyGraphDeltaToMemStateAndUI(delta, mainWindow);
}
