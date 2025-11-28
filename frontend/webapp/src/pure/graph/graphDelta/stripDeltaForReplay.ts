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
        // DeleteNode - strip deletedNode (contains full content)
        return {
            type: 'DeleteNode',
            nodeId: nodeDelta.nodeId
            // deletedNode intentionally omitted for privacy
        }
    }

    // UpsertNode - strip content from the node and previousNode
    return {
        type: 'UpsertNode',
        nodeToUpsert: stripGraphNodeContent(nodeDelta.nodeToUpsert),
        previousNode: nodeDelta.previousNode !== undefined
            ? stripGraphNodeContent(nodeDelta.previousNode)
            : undefined
    }
}

function stripGraphNodeContent(node: GraphNode): GraphNode {
    return {
        ...node,
        contentWithoutYamlOrLinks: '' // Strip content for privacy
    }
}
