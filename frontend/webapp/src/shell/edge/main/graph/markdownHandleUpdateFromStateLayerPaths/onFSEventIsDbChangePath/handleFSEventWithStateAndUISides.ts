import type {FSEvent, GraphDelta, Graph, NodeIdAndFilePath} from "@/pure/graph";
import {mapFSEventsToGraphDelta} from "@/pure/graph";
import type {VaultConfig} from "@/pure/settings/types";
import type {BrowserWindow} from "electron";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {uiAPI} from "@/shell/edge/main/ui-api-proxy";
import {
    applyGraphDeltaToMemState,
    broadcastGraphDeltaToUI
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI";
import {isOurRecentDelta} from "@/shell/edge/main/state/recent-deltas-store";
import {resolveLinksAfterChange, resolveLinkedNodesInWatchedFolder} from "./loadGraphFromDisk";
import {getVaultConfigForDirectory} from "@/shell/edge/main/graph/watch_folder/voicetree-config-io";
import {getWatchedDirectory} from "@/shell/edge/main/state/watch-folder-store";

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

    // 7. Resolve any new links to readOnLinkPaths (lazy loading)
    // This is async but we don't need to wait for it
    void resolveNewLinksToReadOnLinkPaths()

    // 8. Resolve any new links to files in the watched folder
    void resolveNewLinksInWatchedFolder()
}

/**
 * Resolves any new links that point to files in readOnLinkPaths.
 * Called after a file change to load lazily-linked nodes.
 */
async function resolveNewLinksToReadOnLinkPaths(): Promise<void> {
    const watchedDir: string | null = getWatchedDirectory();
    if (!watchedDir) return;

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config?.readOnLinkPaths || config.readOnLinkPaths.length === 0) return;

    const currentGraph: Graph = getGraph();
    const updatedGraph: Graph = await resolveLinksAfterChange(currentGraph, config.readOnLinkPaths);

    // Check if any new nodes were added
    const currentNodeCount: number = Object.keys(currentGraph.nodes).length;
    const updatedNodeCount: number = Object.keys(updatedGraph.nodes).length;

    if (updatedNodeCount > currentNodeCount) {
        // Update graph state
        setGraph(updatedGraph);

        // Compute delta for new nodes only
        const newNodeIds: readonly string[] = Object.keys(updatedGraph.nodes).filter(
            (nodeId: string) => !currentGraph.nodes[nodeId]
        );

        const newNodesDelta: GraphDelta = newNodeIds.map((nodeId: string) => ({
            type: 'UpsertNode' as const,
            nodeToUpsert: updatedGraph.nodes[nodeId],
            previousNode: { _tag: 'None' } as const
        }));

        // Broadcast new nodes to UI
        applyGraphDeltaToMemState(newNodesDelta);
        broadcastGraphDeltaToUI(newNodesDelta);

        console.log(`[handleFSEvent] Lazy loaded ${newNodeIds.length} nodes from readOnLinkPaths`);
    }
}

/**
 * Resolves any new links that point to files in the watched folder.
 * Uses ripgrep-based file search to find matching files.
 */
async function resolveNewLinksInWatchedFolder(): Promise<void> {
    const watchedDir: string | null = getWatchedDirectory();
    if (!watchedDir) return;

    const currentGraph: Graph = getGraph();
    const updatedGraph: Graph = await resolveLinkedNodesInWatchedFolder(currentGraph, watchedDir);

    // Check if any new nodes were added
    const currentNodeCount: number = Object.keys(currentGraph.nodes).length;
    const updatedNodeCount: number = Object.keys(updatedGraph.nodes).length;

    if (updatedNodeCount > currentNodeCount) {
        // Update graph state
        setGraph(updatedGraph);

        // Compute delta for new nodes only
        const newNodeIds: readonly string[] = Object.keys(updatedGraph.nodes).filter(
            (nodeId: string) => !currentGraph.nodes[nodeId]
        );

        const newNodesDelta: GraphDelta = newNodeIds.map((nodeId: string) => ({
            type: 'UpsertNode' as const,
            nodeToUpsert: updatedGraph.nodes[nodeId],
            previousNode: { _tag: 'None' } as const
        }));

        // Broadcast new nodes to UI
        applyGraphDeltaToMemState(newNodesDelta);
        broadcastGraphDeltaToUI(newNodesDelta);

        console.log(`[handleFSEvent] Resolved ${newNodeIds.length} linked nodes from watched folder`);
    }
}
