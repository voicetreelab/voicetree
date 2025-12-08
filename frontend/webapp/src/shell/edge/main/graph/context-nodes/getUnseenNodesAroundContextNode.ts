import type { Graph, NodeIdAndFilePath, GraphNode } from '@/pure/graph'
import { getSubgraphByDistance } from '@/pure/graph'
import { getGraph } from '@/shell/edge/main/state/graph-store'
import { getCachedSettings } from '@/shell/edge/main/state/settings-cache'
import { DEFAULT_SETTINGS, type VTSettings } from '@/pure/settings/types'

/**
 * Result type for unseen nodes
 */
export interface UnseenNode {
    readonly nodeId: NodeIdAndFilePath
    readonly content: string
}

/**
 * Gets nodes around a context node that weren't included in the original context.
 *
 * This function:
 * 1. Reads the context node's containedNodeIds from its metadata
 * 2. Uses the first containedNodeId as the starting point (the parent node)
 * 3. Re-runs the same graph traversal (getSubgraphByDistance with contextNodeMaxDistance from settings)
 * 4. Returns nodes that are in the new traversal but NOT in containedNodeIds
 *
 * @param contextNodeId - The ID of the context node
 * @returns Array of unseen nodes with their content (without YAML/frontmatter)
 */
export function getUnseenNodesAroundContextNode(
    contextNodeId: NodeIdAndFilePath
): readonly UnseenNode[] {
    const currentGraph: Graph = getGraph()

    // 1. Get the context node
    const contextNode: GraphNode | undefined = currentGraph.nodes[contextNodeId]
    if (!contextNode) {
        throw new Error(`Context node ${contextNodeId} not found in graph`)
    }

    // 2. Get containedNodeIds from metadata
    const containedNodeIds: readonly NodeIdAndFilePath[] | undefined = contextNode.nodeUIMetadata.containedNodeIds
    if (!containedNodeIds || containedNodeIds.length === 0) {
        throw new Error(`Context node ${contextNodeId} has no containedNodeIds metadata`)
    }

    // 3. The first containedNodeId is the parent node used to create the context
    const parentNodeId: NodeIdAndFilePath = containedNodeIds[0]

    // 4. Re-run the graph traversal from the parent node
    const settings: VTSettings = getCachedSettings() ?? DEFAULT_SETTINGS
    const subgraph: Graph = getSubgraphByDistance(
        currentGraph,
        parentNodeId,
        settings.contextNodeMaxDistance
    )

    // 5. Create a Set from containedNodeIds for O(1) lookup
    const seenNodeIds: ReadonlySet<NodeIdAndFilePath> = new Set(containedNodeIds)

    // 6. Filter to nodes NOT in containedNodeIds (excluding context nodes)
    const unseenNodes: readonly UnseenNode[] = Object.values(subgraph.nodes)
        .filter((node: GraphNode) =>
            !seenNodeIds.has(node.relativeFilePathIsID) &&
            !node.nodeUIMetadata.isContextNode
        )
        .map((node: GraphNode) => ({
            nodeId: node.relativeFilePathIsID,
            content: node.contentWithoutYamlOrLinks
        }))

    return unseenNodes
}
