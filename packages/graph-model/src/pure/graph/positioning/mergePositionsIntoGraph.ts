import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, Position, NodeIdAndFilePath } from '..'

/**
 * Merge loaded positions into graph nodes.
 * JSON positions take priority over any YAML-sourced positions.
 * Nodes without a JSON position keep their YAML position (migration).
 */
export function mergePositionsIntoGraph(graph: Graph, positions: ReadonlyMap<NodeIdAndFilePath, Position>): Graph {
    if (positions.size === 0) return graph

    const updatedNodes: Record<string, GraphNode> = Object.entries(graph.nodes).reduce(
        (acc: Record<string, GraphNode>, [nodeId, node]: readonly [string, GraphNode]) => {
            const pos: Position | undefined = positions.get(nodeId)
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
                }
            }
            return { ...acc, [nodeId]: node }
        },
        {}
    )

    return {
        ...graph,
        nodes: updatedNodes
    }
}
