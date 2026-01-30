import type {NodeDefinition} from "cytoscape";
import type {Graph, GraphNode, GraphDelta} from "@/pure/graph";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {getTerminalRecords} from "@/shell/edge/main/terminals/terminal-registry";
import {applyGraphDeltaToDBThroughMemAndUI} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI";
import * as O from "fp-ts/lib/Option.js";

/**
 * Save node positions from Cytoscape UI back to graph state.
 * Lightweight update - only touches in-memory state, no filesystem writes.
 * Positions will persist to disk when nodes are saved for other reasons.
 *
 * @param cyNodes - Result of cy.nodes().jsons() (note: @types/cytoscape incorrectly types this as string[])
 */
export function saveNodePositions(cyNodes: readonly NodeDefinition[]): void {
    //console.log("Saving node positions to graph");
    const graph: Graph = getGraph();

    // Build lookup from cytoscape node JSON
    const positionMap: Map<string, { x: number, y: number }> = new Map(
        cyNodes
            .filter(n => n.data.id && n.position)
            .map(n => [n.data.id as string, n.position as { x: number, y: number }])
    );

    const updatedNodes: Record<string, GraphNode> = Object.entries(graph.nodes).reduce(
        (acc: Record<string, GraphNode>, [nodeId, node]: [string, GraphNode]) => {
            const pos: { x: number, y: number } | undefined = positionMap.get(nodeId);
            if (pos) {
                return {
                    ...acc,
                    [nodeId]: {
                        ...node,
                        nodeUIMetadata: {
                            ...node.nodeUIMetadata,
                            position: O.some(pos)
                        }
                    }
                };
            }
            return {...acc, [nodeId]: node};
        },
        {}
    );

    //console.log("Saved node positions to graph");

    setGraph({
        nodes: updatedNodes,
        incomingEdgesIndex: graph.incomingEdgesIndex,
        nodeByBaseName: graph.nodeByBaseName,
        unresolvedLinksIndex: graph.unresolvedLinksIndex
    });
}

/**
 * Find and delete context nodes that are not attached to any active terminal.
 * Context nodes are temporary - they should be cleaned up when their terminal closes.
 *
 * Called on app quit to clean up any remaining context nodes.
 * NOT called during normal operation to avoid race conditions with terminal spawning.
 */
export async function cleanupOrphanedContextNodes(): Promise<void> {
    const graph: Graph = getGraph();

    // Get all context nodes
    const contextNodeIds: string[] = Object.entries(graph.nodes)
        .filter(([_, node]) => node.nodeUIMetadata.isContextNode === true)
        .map(([nodeId, _]) => nodeId);

    if (contextNodeIds.length === 0) {
        return;
    }

    // Get all node IDs attached to active terminals
    const activeTerminalNodeIds: Set<string> = new Set(
        getTerminalRecords().map(record => record.terminalData.attachedToNodeId)
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
    await applyGraphDeltaToDBThroughMemAndUI(deleteDelta, false);
}