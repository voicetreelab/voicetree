import type { Graph, GraphNode, NodeIdAndFilePath } from '../..'
import { reverseGraphEdges } from '../transforms/graph-transformations'

/** Returns the IDs of all root nodes — nodes with no incoming edges. */
export function findRootNodeIds(graph: Graph): readonly NodeIdAndFilePath[] {
    const reversed: Graph = reverseGraphEdges(graph)
    return Object.keys(graph.nodes).filter(nodeId => {
        const reversedNode: GraphNode = reversed.nodes[nodeId]
        return !reversedNode || reversedNode.outgoingEdges.length === 0
    })
}
