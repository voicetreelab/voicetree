import type {FSEvent, GraphDelta, Graph} from "@/pure/graph";
import {mapFSEventsToGraphDelta} from "@/pure/graph";
import type {BrowserWindow} from "electron";
import {applyGraphDeltaToMemStateAndUI} from "@/shell/edge/main/graph/markdownReadWritePaths/applyGraphDeltaToMemStateAndUI";
import {getGraph} from "@/shell/edge/main/state/graph-store";
import {isOurRecentWrite} from "@/shell/edge/main/state/recent-writes-store";
import {uiAPI} from "@/shell/edge/main/ui-api-proxy";

/**
 * Handle filesystem events by:
 * 1. Checking if this is our own recent write (skip if so)
 * 2. Computing the GraphDelta from the filesystem event
 * 3. Applying delta to graph state and UI
 *
 * This is the central handler that connects:
 * - Pure layer: mapFSEventsToGraphDelta
 * - State + UI-edge layer: applyGraphDeltaToMemStateAndUI
 *
 * @param fsEvent - Filesystem event (add, change, or delete)
 * @param vaultPath - Absolute path to vault
 * @param _mainWindow - Electron window (unused, kept for API compatibility)
 */
export function handleFSEventWithStateAndUISides(
    fsEvent: FSEvent,
    vaultPath: string,
    _mainWindow: BrowserWindow
): void {
    // 1. Check if this is our own recent write - skip if so
    const content: string | undefined = 'content' in fsEvent ? fsEvent.content : undefined
    if (isOurRecentWrite(fsEvent.absolutePath, content)) {
        console.log("[handleFSEvent] Skipping our own recent write:", fsEvent.absolutePath)
        return
    }

    // 2. Get current graph state to resolve wikilinks
    const currentGraph: Graph = getGraph()

    // 3. Map filesystem event to graph delta (pure)
    const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, vaultPath, currentGraph)

    // 4. Apply delta to memory state and broadcast to UI
    applyGraphDeltaToMemStateAndUI(delta)

    // 5. Update floating editors (READ PATH ONLY - external FS changes)
    uiAPI.updateFloatingEditorsFromExternal(delta)
}
