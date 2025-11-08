import type {FSEvent, GraphDelta} from "@/functional_graph/pure/types.ts";
import {mapFSEventsToGraphDelta} from "@/functional_graph/pure/mapFSEventsToGraphDelta.ts";
import type {BrowserWindow} from "electron";
import {applyGraphDeltaToMemStateAndUI} from "@/functional_graph/shell/main/readAndDBEventsPath/applyGraphDeltaToMemStateAndUI.ts";
import {getGraph} from "@/functional_graph/shell/state/graph-store.ts";

/**
 * Handle filesystem events by:
 * 1. Computing the GraphDelta from the filesystem event
 * 2. Applying delta to graph state
 * 3. Broadcasting delta to UI
 *
 * This is the central handler that connects:
 * - Pure layer: mapFSEventsToGraphDelta
 * - State + UI layer: applyGraphDeltaToMemStateAndUI
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
    const currentGraph = getGraph();

    // 2. Map filesystem event to graph delta (pure)
    const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, vaultPath, currentGraph);

    applyGraphDeltaToMemStateAndUI(delta, mainWindow);
}
