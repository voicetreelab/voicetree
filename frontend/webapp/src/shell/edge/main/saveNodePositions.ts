import type {NodeDefinition} from "cytoscape";
import type {Graph, GraphNode} from "@/pure/graph";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import * as O from "fp-ts/lib/Option.js";

/**
 * Save node positions from Cytoscape UI back to graph state.
 * Lightweight update - only touches in-memory state, no filesystem writes.
 * Positions will persist to disk when nodes are saved for other reasons.
 *
 * @param cyNodes - Result of cy.nodes().jsons() (note: @types/cytoscape incorrectly types this as string[])
 */
export function saveNodePositions(cyNodes: readonly NodeDefinition[]): void {
    console.log("Saving node positions to graph");
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

    console.log("Saved node positions to graph");

    setGraph({nodes: updatedNodes});
}