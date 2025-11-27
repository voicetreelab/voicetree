import * as O from 'fp-ts/lib/Option.js'
import type { GraphNode, NodeIdAndFilePath, Position } from '@/pure/graph'

/**
 * Extracts the title from a node's content.
 * Returns the text after the first # header, or 'Untitled' if no header is found.
 */
function getTitleFromContent(content: string): string {
    const match: RegExpMatchArray | null = content.match(/^#\s+(.+)$/m)
    return match ? match[1] : 'Untitled'
}

/**
 * Calculates the centroid position from nodes that have positions.
 * Returns O.none if no nodes have positions.
 */
function calculateCentroid(nodes: readonly GraphNode[]): O.Option<Position> {
    const nodesWithPositions: readonly GraphNode[] = nodes.filter(node => O.isSome(node.nodeUIMetadata.position))

    if (nodesWithPositions.length === 0) {
        return O.none
    }

    const sum: { readonly x: number; readonly y: number } = nodesWithPositions.reduce(
        (acc, node) => {
            if (O.isSome(node.nodeUIMetadata.position)) {
                return {
                    x: acc.x + node.nodeUIMetadata.position.value.x,
                    y: acc.y + node.nodeUIMetadata.position.value.y
                }
            }
            return acc
        },
        { x: 0, y: 0 }
    )

    return O.some({
        x: sum.x / nodesWithPositions.length,
        y: sum.y / nodesWithPositions.length
    })
}

/**
 * Creates a new representative node from merged nodes.
 *
 * The representative node:
 * - Has a position at the centroid of all merged nodes with positions
 * - Has content combining all node titles: "# Merged: Title1, Title2, Title3"
 * - Has no outgoing edges (the subgraph is collapsed)
 * - Uses the first node's color if available, otherwise O.none
 * - Has isContextNode set to false and containedNodeIds as undefined
 */
export function createRepresentativeNode(
    nodesToMerge: readonly GraphNode[],
    newNodeId: NodeIdAndFilePath
): GraphNode {
    const titles: readonly string[] = nodesToMerge.map(node => getTitleFromContent(node.contentWithoutYamlOrLinks))
    const content: string = `# Merged: ${titles.join(', ')}`

    const position: O.Option<Position> = calculateCentroid(nodesToMerge)

    const firstNodeColor: O.Option<string> = nodesToMerge.length > 0 ? nodesToMerge[0].nodeUIMetadata.color : O.none

    return {
        relativeFilePathIsID: newNodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: firstNodeColor,
            position,
            additionalYAMLProps: new Map(),
            isContextNode: false,
            containedNodeIds: undefined
        }
    }
}
