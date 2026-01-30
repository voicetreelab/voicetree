import * as O from 'fp-ts/lib/Option.js'
import type { Edge, Graph, GraphNode, NodeIdAndFilePath, Position } from '@/pure/graph'
import { graphToAscii, createGraph } from '@/pure/graph'

/**
 * Information for generating the merge node title.
 * If provided, uses "{representativeTitle} + {otherNodesCount} other nodes" format.
 * If not provided, falls back to "Merged Node".
 */
export interface MergeTitleInfo {
    readonly representativeTitle: string
    readonly otherNodesCount: number
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
            // We know position exists because we filtered for it
            const pos: Position = (node.nodeUIMetadata.position as O.Some<Position>).value
            return {
                x: acc.x + pos.x,
                y: acc.y + pos.y
            }
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
 * Used for ASCII tree visualization of the merged subgraph structure.
 */
function buildSubgraphFromNodes(nodesToMerge: readonly GraphNode[]): Graph {
    const nodeIdSet: ReadonlySet<NodeIdAndFilePath> = new Set(nodesToMerge.map(n => n.absoluteFilePathIsID))

    const nodes: Record<NodeIdAndFilePath, GraphNode> = nodesToMerge.reduce(
        (acc, node) => {
            // Filter edges to only keep internal ones (for ASCII tree visualization)
            const internalEdges: readonly Edge[] = node.outgoingEdges.filter(edge => nodeIdSet.has(edge.targetId))
            return {
                ...acc,
                [node.absoluteFilePathIsID]: {
                    ...node,
                    outgoingEdges: internalEdges
                }
            }
        },
        {} as Record<NodeIdAndFilePath, GraphNode>
    )

    return createGraph(nodes)
}

/**
 * Collects all outgoing edges from merged nodes that point to external nodes.
 * Deduplicates edges by targetId (keeps first occurrence).
 */
function getExternalOutgoingEdges(
    nodesToMerge: readonly GraphNode[]
): readonly Edge[] {
    const nodeIdSet: ReadonlySet<NodeIdAndFilePath> = new Set(nodesToMerge.map(n => n.absoluteFilePathIsID))

    const allExternalEdges: readonly Edge[] = nodesToMerge.flatMap(node =>
        node.outgoingEdges.filter(edge => !nodeIdSet.has(edge.targetId))
    )

    // Deduplicate by targetId (keep first occurrence)
    const dedupedEdges: readonly Edge[] = allExternalEdges.reduce<readonly Edge[]>(
        (acc, edge) => {
            const alreadySeen: boolean = acc.some(e => e.targetId === edge.targetId)
            return alreadySeen ? acc : [...acc, edge]
        },
        []
    )

    return dedupedEdges
}

/**
 * Generates the title for the merged node.
 * If mergeTitleInfo is provided, uses "{representativeTitle} + N other nodes" format.
 * Otherwise falls back to "Merged Node".
 */
function generateMergeTitle(mergeTitleInfo: MergeTitleInfo | undefined): string {
    if (mergeTitleInfo === undefined) {
        return 'Merged Node'
    }

    const { representativeTitle, otherNodesCount } = mergeTitleInfo

    if (otherNodesCount === 0) {
        return representativeTitle
    }

    const nodeWord: string = otherNodesCount === 1 ? 'node' : 'nodes'
    return `${representativeTitle} + ${otherNodesCount} other ${nodeWord}`
}

/**
 * Creates a new representative node from merged nodes.
 *
 * The representative node:
 * - Has a position at the centroid of all merged nodes with positions
 * - Has content with ASCII tree visualization of the subgraph structure
 * - Accumulates all content from merged nodes
 * - Preserves outgoing edges to external nodes (outside the subgraph)
 * - Uses the first node's color if available, otherwise O.none
 * - Has isContextNode set to false and containedNodeIds as undefined
 *
 * @param nodesToMerge - The nodes being merged
 * @param newNodeId - The ID for the new merged node
 * @param mergeTitleInfo - Optional info for generating the title. If provided, uses
 *                         "{representativeTitle} + N other nodes" format.
 */
export function createRepresentativeNode(
    nodesToMerge: readonly GraphNode[],
    newNodeId: NodeIdAndFilePath,
    mergeTitleInfo?: MergeTitleInfo
): GraphNode {
    // Build subgraph for ASCII visualization
    const subgraph: Graph = buildSubgraphFromNodes(nodesToMerge)
    const asciiTree: string = graphToAscii(subgraph)

    // Accumulate all content from nodes
    const allContent: string = nodesToMerge
        .map(node => node.contentWithoutYamlOrLinks)
        .join('\n\n---\n\n')

    // Generate the title based on representative parent (if available)
    const title: string = generateMergeTitle(mergeTitleInfo)

    // Build merged content with ASCII tree header and accumulated content
    const content: string = `# ${title}

\`\`\`
${asciiTree}
\`\`\`

${allContent}`

    const position: O.Option<Position> = calculateCentroid(nodesToMerge)

    const firstNodeColor: O.Option<string> = nodesToMerge.length > 0 ? nodesToMerge[0].nodeUIMetadata.color : O.none

    // Preserve outgoing edges to nodes outside the subgraph
    const externalOutgoingEdges: readonly Edge[] = getExternalOutgoingEdges(nodesToMerge)

    return {
        absoluteFilePathIsID: newNodeId,
        outgoingEdges: externalOutgoingEdges,
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
