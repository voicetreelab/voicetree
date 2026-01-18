import type {FSEvent, GraphDelta, Graph, GraphNode, NodeIdAndFilePath} from "@/pure/graph";
import {mapFSEventsToGraphDelta} from "@/pure/graph";
import type {BrowserWindow} from "electron";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {uiAPI} from "@/shell/edge/main/ui-api-proxy";
import {
    applyGraphDeltaToMemState,
    broadcastGraphDeltaToUI
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI";
import {isOurRecentDelta} from "@/shell/edge/main/state/recent-deltas-store";
import {resolveLinkedNodesInWatchedFolder} from "./loadGraphFromDisk";
import {getWatchedDirectory} from "@/shell/edge/main/state/watch-folder-store";
import * as O from "fp-ts/lib/Option.js";

/**
 * Handle filesystem events by:
 * 1. Checking if this is our own recent write (skip if so)
 * 2. Computing the GraphDelta from the filesystem event
 * 3. Applying delta to graph state
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

    // 4. Apply delta to memory state
    applyGraphDeltaToMemState(delta)

    // 5. Broadcast to UI - triggers both applyGraphDeltaToUI (cytoscape) and updateFloatingEditors
    broadcastGraphDeltaToUI(delta)

    // broadcast to floating editor state
    uiAPI.updateFloatingEditorsFromExternal(delta)

    // 6. Auto-pin editor for external node upserts (created or updated, not context nodes)
    delta
        .filter((d) => d.type === 'UpsertNode' && !d.nodeToUpsert.nodeUIMetadata.isContextNode)
        .map((d) => d.type === 'UpsertNode' ? d.nodeToUpsert.absoluteFilePathIsID : '')
        .filter((id): id is NodeIdAndFilePath => id !== '')
        .forEach((nodeId) => uiAPI.createEditorForExternalNode(nodeId))

    // 7. Resolve any new links to files in the watched folder (resolve-on-link)
    // This applies to files outside writePath/readPaths
    void resolveNewLinksInWatchedFolder()
}

/**
 * Checks if two nodes have different edges (for detecting healed edges).
 */
function edgesChanged(oldNode: GraphNode, newNode: GraphNode): boolean {
    if (oldNode.outgoingEdges.length !== newNode.outgoingEdges.length) return true;
    return oldNode.outgoingEdges.some((oldEdge, i) => {
        const newEdge: { readonly targetId: string; readonly label: string } = newNode.outgoingEdges[i];
        return oldEdge.targetId !== newEdge.targetId || oldEdge.label !== newEdge.label;
    });
}

/**
 * Resolves any new links that point to files in the watched folder.
 * Uses ripgrep-based file search to find matching files.
 *
 * This is the "resolve-on-link" behavior for files in the watched folder
 * that are outside writePath/readPaths.
 */
async function resolveNewLinksInWatchedFolder(): Promise<void> {
    const watchedDir: string | null = getWatchedDirectory();
    if (!watchedDir) return;

    const currentGraph: Graph = getGraph();
    const updatedGraph: Graph = await resolveLinkedNodesInWatchedFolder(currentGraph, watchedDir);

    // Find new nodes (nodes that didn't exist before)
    const newNodeIds: readonly string[] = Object.keys(updatedGraph.nodes).filter(
        (nodeId: string) => !currentGraph.nodes[nodeId]
    );

    // Find healed nodes (existing nodes whose edges were updated)
    const healedNodeIds: readonly string[] = Object.keys(updatedGraph.nodes).filter(
        (nodeId: string) => {
            const oldNode: GraphNode | undefined = currentGraph.nodes[nodeId];
            if (!oldNode) return false; // New node, not healed
            const newNode: GraphNode = updatedGraph.nodes[nodeId];
            return edgesChanged(oldNode, newNode);
        }
    );

    // Only proceed if there are changes
    if (newNodeIds.length === 0 && healedNodeIds.length === 0) return;

    // Update graph state
    setGraph(updatedGraph);

    // Build delta for new nodes
    const newNodesDelta: GraphDelta = newNodeIds.map((nodeId: string) => ({
        type: 'UpsertNode' as const,
        nodeToUpsert: updatedGraph.nodes[nodeId],
        previousNode: O.none
    }));

    // Build delta for healed nodes (include previousNode for proper diffing)
    const healedNodesDelta: GraphDelta = healedNodeIds.map((nodeId: string) => ({
        type: 'UpsertNode' as const,
        nodeToUpsert: updatedGraph.nodes[nodeId],
        previousNode: O.some(currentGraph.nodes[nodeId])
    }));

    // Combine all deltas
    const combinedDelta: GraphDelta = [...newNodesDelta, ...healedNodesDelta];

    // Broadcast all changes to UI
    applyGraphDeltaToMemState(combinedDelta);
    broadcastGraphDeltaToUI(combinedDelta);

    console.log(`[handleFSEvent] Resolved ${newNodeIds.length} new nodes, healed ${healedNodeIds.length} edges from watched folder`);
}
