import * as O from 'fp-ts/lib/Option.js'
import type {FSEvent, GraphDelta, Graph, NodeDelta} from '@vt/graph-model/graph';
import {mapFSEventsToGraphDelta} from '@vt/graph-model/graph';
import {getNodeTitle} from '@vt/graph-model/markdown'
import {toAbsolutePath} from '@vt/graph-model/folders';
import {getGraph} from "@vt/graph-db-server/state/graph-store";
import {getCallbacks} from "@vt/graph-model";
import {
    applyGraphDeltaToMemState,
    refreshGraphChangeSideEffects
} from "../mutations/applyGraphDelta";
import {isOurRecentDelta} from "@vt/graph-db-server/state/recent-deltas-store";
import {publish} from "@vt/graph-db-server/state/events/deltaEventBus";
import {getFolderTreeReadModel} from "@vt/graph-db-server/state/folder-tree-read-model-store";

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
 */
export function handleFSEventWithStateAndUISides(
    fsEvent: FSEvent,
    _watchedDirectory: string,
    suppressBroadcastTo: ReadonlySet<string> = new Set(),
): void {
    // 2. Get current graph state to resolve wikilinks
    const currentGraph: Graph = getGraph()

    // 3. Map filesystem event to graph delta (pure) - node IDs are absolute paths
    const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, currentGraph)

    //  Check if this is our own recent write - skip if so
    if (isOurRecentDelta(delta)) {
        return
    }

    // Structural events (file added or deleted) invalidate the folder-tree
    // read model so the next sidebar/live-state read sees the new directory
    // shape. Content-only 'Changed' events do NOT invalidate — the in-memory
    // graph delta path handles those.
    invalidateFolderTreeForFSEvent(fsEvent)

    // 4. Apply delta to memory state and resolve any new wikilinks
    // Uses void since this is fire-and-forget from FS event handler
    void applyAndBroadcast(delta, suppressBroadcastTo)
}

function invalidateFolderTreeForFSEvent(fsEvent: FSEvent): void {
    const isStructuralChange: boolean =
        ('type' in fsEvent && fsEvent.type === 'Delete') ||
        ('eventType' in fsEvent && fsEvent.eventType === 'Added')
    if (!isStructuralChange) return
    getFolderTreeReadModel().invalidate({
        kind: 'pathChanged',
        absolutePath: toAbsolutePath(fsEvent.absolutePath),
    })
}

/**
 * Apply delta to memory, broadcast to UI, and handle editor updates.
 * Extracted to allow async/await while keeping the main handler sync.
 */
async function applyAndBroadcast(
    delta: GraphDelta,
    suppressBroadcastTo: ReadonlySet<string>,
): Promise<void> {
    // Apply to memory and resolve any new wikilinks (returns merged delta)
    const mergedDelta: GraphDelta = await applyGraphDeltaToMemState(delta)

    refreshGraphChangeSideEffects()

    // Publish to SSE event bus for daemon clients
    publish({
        delta: mergedDelta,
        source: 'fs:external',
        suppressForSubscribers: [...suppressBroadcastTo],
    })

    // Broadcast to floating editor state via callback
    getCallbacks().onFloatingEditorUpdate?.(mergedDelta, [...suppressBroadcastTo])

    // Register filesystem-written nodes that have agent_name frontmatter,
    // so wait_for_agents recognises them as agent progress.
    notifyAgentNodesFromDelta(mergedDelta)
}

function notifyAgentNodesFromDelta(delta: GraphDelta): void {
    const callback = getCallbacks().onFSNodeWithAgentName
    if (!callback) return

    for (const d of delta) {
        if (d.type !== 'UpsertNode' || O.isSome(d.previousNode)) continue
        const agentName: string | undefined = d.nodeToUpsert.nodeUIMetadata.additionalYAMLProps['agent_name']
        if (!agentName) continue
        const title: string = getNodeTitle(d.nodeToUpsert)
        callback(agentName, d.nodeToUpsert.absoluteFilePathIsID, title)
    }
}
