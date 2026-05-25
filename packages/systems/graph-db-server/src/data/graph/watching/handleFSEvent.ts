import { access } from 'node:fs/promises'
import * as O from 'fp-ts/lib/Option.js'
import type {DeleteNode, FSEvent, GraphDelta, Graph, NodeDelta} from '@vt/graph-model/graph';
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
import {isPendingWrite} from "@vt/graph-db-server/watch-folder/pending-writes";

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
    void (async () => {
        const merged = await applyDeltaToMemAndBroadcast(delta, 'fs:external', suppressBroadcastTo)
        notifyAgentNodesFromDelta(merged)
    })()
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
 * Apply a delta to in-memory graph state, then broadcast the merged delta
 * (including lazy wikilink resolutions) to SSE subscribers and floating editors.
 */
async function applyDeltaToMemAndBroadcast(
    delta: GraphDelta,
    source: 'fs:external' | 'reconcile:disk',
    suppressBroadcastTo: ReadonlySet<string> = new Set(),
): Promise<GraphDelta> {
    const mergedDelta: GraphDelta = await applyGraphDeltaToMemState(delta)
    refreshGraphChangeSideEffects()

    const suppressList: string[] = [...suppressBroadcastTo]
    publish({delta: mergedDelta, source, suppressForSubscribers: suppressList})
    getCallbacks().onFloatingEditorUpdate?.(mergedDelta, suppressList)

    return mergedDelta
}

function notifyAgentNodesFromDelta(delta: GraphDelta): void {
    const callback = getCallbacks().onFSNodeWithAgentName
    if (!callback) return

    for (const d of delta) {
        if (d.type !== 'UpsertNode' || O.isSome(d.previousNode)) continue
        const agentName: string | undefined = d.nodeToUpsert.nodeUIMetadata.additionalYAMLProps.get('agent_name')
        if (!agentName) continue
        const title: string = getNodeTitle(d.nodeToUpsert)
        callback(agentName, d.nodeToUpsert.absoluteFilePathIsID, title)
    }
}

async function pathExistsOnDisk(absolutePath: string): Promise<boolean> {
    try {
        await access(absolutePath)
        return true
    } catch {
        return false
    }
}

/**
 * One-shot reconciliation: delete graph nodes whose backing files are gone
 * from disk. Skips paths with pending daemon writes (so a delete racing a
 * write does not undo the write). Applies the resulting delta to memory and
 * broadcasts it via the same path that handleFSEventWithStateAndUISides uses.
 *
 * Used at vault-open and on the daemon `/graph/reconcile-disk` route so that
 * an external file removal (git checkout, manual `rm`, agent batch) does not
 * leave stale nodes in the in-memory graph or in any open floating editors.
 */
export async function reconcileGraphWithDisk(): Promise<GraphDelta> {
    const currentGraph: Graph = getGraph()
    const deletes: DeleteNode[] = []
    for (const [nodeId, node] of Object.entries(currentGraph.nodes)) {
        if (isPendingWrite(nodeId)) continue
        if (await pathExistsOnDisk(nodeId)) continue
        deletes.push({type: 'DeleteNode', nodeId, deletedNode: O.some(node)})
    }
    if (deletes.length === 0) return []
    return applyDeltaToMemAndBroadcast(deletes, 'reconcile:disk')
}
