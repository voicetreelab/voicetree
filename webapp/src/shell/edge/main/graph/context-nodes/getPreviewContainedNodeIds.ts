import type { Graph, NodeIdAndFilePath, GraphNode } from '@/pure/graph'
import { getSubgraphByDistance } from '@/pure/graph'
import { getGraph } from '@/shell/edge/main/state/graph-store'
import { loadSettings } from '@/shell/edge/main/settings/settings_IO'
import { type VTSettings } from '@/pure/settings/types'

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
        console.warn(`[getPreviewContainedNodeIds] Node ${nodeId} not found in graph`)
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
