import * as O from 'fp-ts/lib/Option.js'
import type { Edge, Graph, GraphNode, NodeIdAndFilePath, Position } from '@/pure/graph'
import { graphToAscii } from '@/pure/graph'

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
 * Builds a subgraph from the nodes to merge, keeping only internal edges.
 */
//todo this is unnec
function buildSubgraphFromNodes(nodesToMerge: readonly GraphNode[]): Graph {
    const nodes: Record<NodeIdAndFilePath, GraphNode> = nodesToMerge.reduce(
        (acc, node) => {
        // keep outgoing edges going out of subgraph
            // Filter edges to only keep internal ones (edges to other nodes in the selection)
            // const internalEdges: readonly Edge[] = node.outgoingEdges.filter(edge => nodeIdSet.has(edge.targetId))
            return {
                ...acc,
                [node.relativeFilePathIsID]: {
                    ...node,
                }
            }
        },
        {} as Record<NodeIdAndFilePath, GraphNode>
    )

    return { nodes }
}

/**
 * Creates a new representative node from merged nodes.
 *
 * The representative node:
 * - Has a position at the centroid of all merged nodes with positions
 * - Has content with ASCII tree visualization of the subgraph structure
 * - Accumulates all content from merged nodes
 * - Has no outgoing edges (the subgraph is collapsed)
 * - Uses the first node's color if available, otherwise O.none
 * - Has isContextNode set to false and containedNodeIds as undefined
 */
export function createRepresentativeNode(
    nodesToMerge: readonly GraphNode[],
    newNodeId: NodeIdAndFilePath
): GraphNode {
    // Build subgraph for ASCII visualization
    const subgraph: Graph = buildSubgraphFromNodes(nodesToMerge) // todo we can make this just the nodes
    const asciiTree: string = graphToAscii(subgraph)

    // Accumulate all content from nodes
    const allContent: string = nodesToMerge
        .map(node => node.contentWithoutYamlOrLinks)
        .join('\n\n---\n\n')

    // Build merged content with ASCII tree header and accumulated content
    const content: string = `# Merged Node

\`\`\`
${asciiTree}
\`\`\`

${allContent}`

    const position: O.Option<Position> = calculateCentroid(nodesToMerge)

    const firstNodeColor: O.Option<string> = nodesToMerge.length > 0 ? nodesToMerge[0].nodeUIMetadata.color : O.none

    return {
        relativeFilePathIsID: newNodeId,
        outgoingEdges: [], // todo here, get edges going out of subgraph
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
