import type {NodeDefinition} from "cytoscape";
import type {Graph, GraphDelta, Position} from "@vt/graph-model/graph";
import {getTerminalRecords, type TerminalRecord} from '@vt/vt-daemon-client';
import {getVtDaemonClient} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding';
import {getGraphFromDaemon, postDeltaThroughDaemon} from '@/shell/edge/main/runtime/electron/daemon/ipc/daemon-ipc-proxy';
import {writePositionsThroughDaemon} from '@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-queries';
import * as O from "fp-ts/lib/Option.js";

/**
 * Save node positions from Cytoscape UI through the graph daemon.
 *
 * @param cyNodes - Result of cy.nodes().jsons() (note: @types/cytoscape incorrectly types this as string[])
 */
export async function saveNodePositions(cyNodes: readonly NodeDefinition[]): Promise<void> {
    const positions: Record<string, Position> = collectPositions(cyNodes);
    if (Object.keys(positions).length === 0) {
        return;
    }

    await writePositionsThroughDaemon(positions);
}

/**
 * Find and delete context nodes that are not attached to any active terminal.
 * Context nodes are temporary - they should be cleaned up when their terminal closes.
 *
 * Called on app quit to clean up any remaining context nodes.
 * NOT called during normal operation to avoid race conditions with terminal spawning.
 */
export async function cleanupOrphanedContextNodes(): Promise<void> {
    const graph: Graph = await getGraphFromDaemon();

    // Get all context nodes
    const contextNodeIds: string[] = Object.entries(graph.nodes)
        .filter(([_, node]) => node.nodeUIMetadata.isContextNode === true)
        .map(([nodeId, _]) => nodeId);

    if (contextNodeIds.length === 0) {
        return;
    }

    // Get all node IDs attached to active terminals
    const terminalRecords: readonly TerminalRecord[] = await getTerminalRecords(getVtDaemonClient());
    const activeTerminalNodeIds: Set<string> = new Set(
        terminalRecords.map(record => record.terminalData.attachedToContextNodeId)
    );

    // Find orphaned context nodes (not attached to any terminal)
    const orphanedContextNodeIds: string[] = contextNodeIds.filter(
        nodeId => !activeTerminalNodeIds.has(nodeId)
    );

    if (orphanedContextNodeIds.length === 0) {
        return;
    }

    //console.log(`[saveNodePositions] Cleaning up ${orphanedContextNodeIds.length} orphaned context nodes`);

    // Create delete deltas for orphaned context nodes
    const deleteDelta: GraphDelta = orphanedContextNodeIds.map(nodeId => ({
        type: 'DeleteNode' as const,
        nodeId,
        deletedNode: O.some(graph.nodes[nodeId])
    }));

    // Apply deltas (deletes from filesystem and updates graph state)
    await postDeltaThroughDaemon(deleteDelta);
}

function collectPositions(cyNodes: readonly NodeDefinition[]): Record<string, Position> {
    return cyNodes.reduce((acc: Record<string, Position>, node: NodeDefinition) => {
        const id: unknown = node.data.id;
        const position: Position | undefined = node.position as Position | undefined;
        if (
            typeof id !== 'string'
            || position === undefined
            || !Number.isFinite(position.x)
            || !Number.isFinite(position.y)
        ) {
            return acc;
        }

        return {
            ...acc,
            [id]: position,
        };
    }, {});
}
