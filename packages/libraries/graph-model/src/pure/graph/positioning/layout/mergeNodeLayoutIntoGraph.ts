import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, NodeLayout, NodeIdAndFilePath } from '../..'

/**
 * Merge loaded spatial layout (position + size) into graph nodes.
 *
 * One source of truth for all spatial layout: the node-layout sidecar is loaded
 * into a single Map of {position?, size?} entries and merged here. Sidecar
 * values take priority — a node with a sidecar entry adopts whichever of
 * position / size that entry carries; the other field is left untouched. Nodes
 * with no entry are returned unchanged.
 */
export function mergeNodeLayoutIntoGraph(
    graph: Graph,
    layout: ReadonlyMap<NodeIdAndFilePath, NodeLayout>,
): Graph {
    if (layout.size === 0) return graph

    const updatedNodes: Record<string, GraphNode> = Object.entries(graph.nodes).reduce(
        (acc: Record<string, GraphNode>, [nodeId, node]: readonly [string, GraphNode]) => {
            const entry: NodeLayout | undefined = layout.get(nodeId)
            if (entry === undefined) return { ...acc, [nodeId]: node }

            return {
                ...acc,
                [nodeId]: {
                    ...node,
                    nodeUIMetadata: {
                        ...node.nodeUIMetadata,
                        ...(entry.position ? { position: O.some(entry.position) } : {}),
                        ...(entry.size ? { size: O.some(entry.size) } : {}),
                    },
                },
            }
        },
        {},
    )

    return { ...graph, nodes: updatedNodes }
}
