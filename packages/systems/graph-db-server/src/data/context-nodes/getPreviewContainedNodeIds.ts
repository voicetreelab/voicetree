import type { Graph, NodeIdAndFilePath, GraphNode } from '@vt/graph-model/graph'
import { getSubgraphByDistance } from '@vt/graph-model/graph'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { loadSettings } from '@vt/app-config/settings'
import { type VTSettings } from '@vt/graph-model/settings'

/**
 * Computes which node IDs would be included if a context node were created from the given node.
 *
 * Used for preview highlighting when hovering over the Run button on a normal node -
 * shows the user which nodes will be captured in the context that's about to be created.
 *
 * @param nodeId - The node to compute preview for (non-context node)
 * @returns Array of node IDs that would be contained in the context
 */
export async function getPreviewContainedNodeIds(
    nodeId: NodeIdAndFilePath
): Promise<readonly NodeIdAndFilePath[]> {
    const currentGraph: Graph = getGraph()

    const node: GraphNode | undefined = currentGraph.nodes[nodeId]
    if (!node) {
        return []
    }

    const settings: VTSettings = await loadSettings()
    const subgraph: Graph = getSubgraphByDistance(
        currentGraph,
        nodeId,
        settings.contextNodeMaxDistance
    )

    // Return node IDs excluding context nodes (same filter as buildContextNodeContent)
    return Object.keys(subgraph.nodes)
        .filter(id => !subgraph.nodes[id].nodeUIMetadata.isContextNode)
}
