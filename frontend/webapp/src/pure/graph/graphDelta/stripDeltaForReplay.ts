import type { GraphDelta, NodeDelta, GraphNode } from '@/pure/graph'

/**
 * Strips sensitive content from GraphDelta for analytics/replay
 * Currently removes: content field
 * Keeps: titles, filenames, edges, positions, colors
 */
export function stripDeltaForReplay(delta: GraphDelta): GraphDelta {
    return delta.map(stripNodeDelta)
}

function stripNodeDelta(nodeDelta: NodeDelta): NodeDelta {
    if (nodeDelta.type === 'DeleteNode') {
        // DeleteNode only has nodeId, nothing to strip
        return nodeDelta
    }

    // UpsertNode - strip content from the node
    return {
        type: 'UpsertNode',
        nodeToUpsert: stripGraphNodeContent(nodeDelta.nodeToUpsert)
    }
}

function stripGraphNodeContent(node: GraphNode): GraphNode {
    return {
        ...node,
        contentWithoutYamlOrLinks: '' // Strip content for privacy
    }
}
