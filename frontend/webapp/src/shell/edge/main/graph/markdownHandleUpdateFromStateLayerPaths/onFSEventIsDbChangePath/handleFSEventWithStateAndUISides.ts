import type {FSEvent, GraphDelta, Graph} from "@/pure/graph";
import {mapFSEventsToGraphDelta} from "@/pure/graph";
import type {BrowserWindow} from "electron";
import {getGraph} from "@/shell/edge/main/state/graph-store";
import {isOurRecentWrite} from "@/shell/edge/main/state/recent-writes-store";
import {uiAPI} from "@/shell/edge/UI-edge/api";
import {
    applyGraphDeltaToMemState,
    broadcastGraphDeltaToUI
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI";
import {isOurRecentDelta} from "@/shell/edge/main/state/recent-deltas-store";

/**
 * Handle filesystem events by:
 * 1. Checking if this is our own recent write (skip if so)
 * 2. Computing the GraphDelta from the filesystem event
 * 3. Applying delta to graph state
 * 4. Broadcasting to UI (graph UI + floating editors)
 *
 * FS Event Path: FS → MEM + GraphUI + Editors
 *
 * @param fsEvent - Filesystem event (add, change, or delete)
 * @param watchedDirectory - Absolute path to watched directory
 * @param _mainWindow - Electron window (unused, kept for API compatibility)
 */
export function handleFSEventWithStateAndUISides(
    fsEvent: FSEvent,
    watchedDirectory: string,
    _mainWindow: BrowserWindow
): void {
    // 1. Check if this is our own recent write - skip if so
    if (isOurRecentDelta(fsEvent, watchedDirectory)) {
        console.log("[handleFSEvent] Skipping our own recent write: ", fsEvent.absolutePath)
        return
    }
    console.log("[handleFSEvent] external write from: ", fsEvent.absolutePath)

    // 2. Get current graph state to resolve wikilinks
    const currentGraph: Graph = getGraph()

    // 3. Map filesystem event to graph delta (pure)
    const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, watchedDirectory, currentGraph)

    // 4. Apply delta to memory state
    applyGraphDeltaToMemState(delta)

    // 5. Broadcast to UI - triggers both applyGraphDeltaToUI (cytoscape) and updateFloatingEditors
    broadcastGraphDeltaToUI(delta)

    // broadcast to floating editor state
    uiAPI.updateFloatingEditorsFromExternal(delta)
}
