import type {FSEvent, GraphDelta, Graph, NodeIdAndFilePath} from "@/pure/graph";
import {mapFSEventsToGraphDelta} from "@/pure/graph";
import type {BrowserWindow} from "electron";
import {getGraph} from "@/shell/edge/main/state/graph-store";
import {uiAPI} from "@/shell/edge/main/ui-api-proxy";
import {
    applyGraphDeltaToMemState,
    broadcastGraphDeltaToUI
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI";
import {isOurRecentDelta} from "@/shell/edge/main/state/recent-deltas-store";

/**
 * Handle filesystem events by:
 * 1. Checking if this is our own recent write (skip if so)
 * 2. Computing the GraphDelta from the filesystem event
 * 3. Applying delta to graph state (includes lazy wikilink resolution)
 * 4. Broadcasting to UI (graph UI + floating editors)
 *
 * FS Event Path: FS → MEM + GraphUI + Editors
 *
 * Note: Bulk loads (e.g., adding a new vault path) use loadVaultPathAdditively
 * instead of this function, so no time-based guard is needed here.
 *
 * @param fsEvent - Filesystem event (add, change, or delete)
 * @param _watchedDirectory - Unused (node IDs are now absolute paths)
 * @param _mainWindow - Electron window (unused, kept for API compatibility)
 */
export function handleFSEventWithStateAndUISides(
    fsEvent: FSEvent,
    _watchedDirectory: string,
    _mainWindow: BrowserWindow
): void {
    console.log("[handleFSEvent] external write from: ", fsEvent.absolutePath)

    // 2. Get current graph state to resolve wikilinks
    const currentGraph: Graph = getGraph()

    // 3. Map filesystem event to graph delta (pure) - node IDs are absolute paths
    const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, currentGraph)

    //  Check if this is our own recent write - skip if so
    if (isOurRecentDelta(delta)) {
        console.log("[handleFSEvent] Skipping our own recent write: ", fsEvent.absolutePath)
        return
    }

    // 4. Apply delta to memory state and resolve any new wikilinks
    // Uses void since this is fire-and-forget from FS event handler
    void applyAndBroadcast(delta)
}

/**
 * Apply delta to memory, broadcast to UI, and handle editor updates.
 * Extracted to allow async/await while keeping the main handler sync.
 */
async function applyAndBroadcast(delta: GraphDelta): Promise<void> {
    // Apply to memory and resolve any new wikilinks (returns merged delta)
    const mergedDelta: GraphDelta = await applyGraphDeltaToMemState(delta)

    // Broadcast merged delta (includes resolved links) to UI
    broadcastGraphDeltaToUI(mergedDelta)

    // Broadcast to floating editor state
    uiAPI.updateFloatingEditorsFromExternal(mergedDelta)

    // Auto-pin editor for external node upserts (created or updated, not context nodes)
    mergedDelta
        .filter((d) => d.type === 'UpsertNode' && !d.nodeToUpsert.nodeUIMetadata.isContextNode)
        .map((d) => d.type === 'UpsertNode' ? d.nodeToUpsert.absoluteFilePathIsID : '')
        .filter((id): id is NodeIdAndFilePath => id !== '')
        .forEach((nodeId) => uiAPI.createEditorForExternalNode(nodeId))

    // Log if any links were resolved
    if (mergedDelta.length > delta.length) {
        const resolvedCount: number = mergedDelta.length - delta.length
        console.log(`[handleFSEvent] Resolved ${resolvedCount} linked nodes from watched folder`)
    }
}
