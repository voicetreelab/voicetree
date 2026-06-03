import type {Graph, GraphDelta, NodeIdAndFilePath, GraphNode} from '@vt/graph-model/graph'
import {getSubgraphByDistance, getUnionSubgraphByDistance, graphToAscii, makeBidirectionalEdges} from '@vt/graph-model/graph'
import {getNodeTitle, parseMarkdownToGraphNode} from '@vt/graph-model/markdown'
import {getGraph} from '@vt/graph-db-server/state/graph-store'
import { loadSettings } from '@vt/app-config/settings'
import * as O from 'fp-ts/lib/Option.js'
import path from 'path'
import {type VTSettings} from '@vt/graph-model/settings'
import {calculateInitialPositionForChild} from '@vt/graph-model/spatial'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from "../graph/mutations/applyGraphDelta";
import {ensureUniqueNodeId} from '@vt/graph-model/graph';
import { resolveContextWriteFolderPath } from './contextWriteFolderPath'
import { CONTEXT_NODES_FOLDER } from './contextNodeFolder'
import {
    graphVisibleForContext,
    readCollapsedFolderIdsForContext,
} from './contextFolderVisibility'

type ContextNodeClock = {
    readonly now: () => number
}

export type CreateContextNodeDependencies = {
    readonly clock: ContextNodeClock
}

const defaultCreateContextNodeDependencies: CreateContextNodeDependencies = {
    clock: { now: () => Date.now() },
}

function resolveParentNodeId(
    currentGraph: Graph,
    requestedParentNodeId: NodeIdAndFilePath,
    preferredRoot?: string
): NodeIdAndFilePath {
    if (currentGraph.nodes[requestedParentNodeId]) {
        return requestedParentNodeId
    }

    const matches: readonly NodeIdAndFilePath[] = Object.keys(currentGraph.nodes)
        .filter((nodeId): boolean => path.basename(nodeId) === requestedParentNodeId) as readonly NodeIdAndFilePath[]

    if (matches.length === 1) {
        return matches[0]
    }

    if (preferredRoot) {
        const preferredMatches: readonly NodeIdAndFilePath[] = matches.filter((nodeId): boolean =>
            nodeId.startsWith(preferredRoot + '/')
        ) as readonly NodeIdAndFilePath[]

        if (preferredMatches.length === 1) {
            return preferredMatches[0]
        }
    }

    if (matches.length > 1) {
        throw new Error(`Node ${requestedParentNodeId} is ambiguous in graph`)
    }

    throw new Error(`Node ${requestedParentNodeId} not found in graph`)
}

/**
 * Creates a context node for a given parent node.
 *
 * This orchestrator function:
 * 1. Extracts subgraph within distance 7 using weighted BFS
 * 2. Converts subgraph to ASCII visualization
 * 3. Creates a new context node with the visualization
 * 4. Persists via GraphDelta pipeline
 *
 * @param parentNodeId - The node to create context for
 * @returns The NodeId of the newly created context node
 */
export async function createContextNode(
    parentNodeId: NodeIdAndFilePath,
    semanticNodeIds: readonly NodeIdAndFilePath[] = [],
    dependencies: CreateContextNodeDependencies = defaultCreateContextNodeDependencies
): Promise<NodeIdAndFilePath> {
    // 1. EDGE: Read current graph from state
    const currentGraph: Graph = getGraph()
    const writeFolderPath: string = await resolveContextWriteFolderPath(parentNodeId)
    const resolvedParentNodeId: NodeIdAndFilePath = resolveParentNodeId(
        currentGraph,
        parentNodeId,
        writeFolderPath || undefined
    )

    const visibleGraph: Graph = graphVisibleForContext(currentGraph, readCollapsedFolderIdsForContext())
    const traversalGraph: Graph = visibleGraph.nodes[resolvedParentNodeId] !== undefined
        ? visibleGraph
        : currentGraph

    // 2. PURE: Extract subgraph within distance
    const settings: VTSettings = await loadSettings()
    const maxDistance: number = settings.contextNodeMaxDistance

    const parentNode: GraphNode = currentGraph.nodes[resolvedParentNodeId]
    const validSemanticNodeIds: readonly NodeIdAndFilePath[] = settings.enableSemanticContext
        ? semanticNodeIds.filter((nodeId: NodeIdAndFilePath): boolean => traversalGraph.nodes[nodeId] !== undefined)
        : []

    // Get subgraph - union if we have semantic results, otherwise distance-only
    const subgraph: Graph = validSemanticNodeIds.length > 0
        ? getUnionSubgraphByDistance(
            traversalGraph,
            [resolvedParentNodeId, ...validSemanticNodeIds],
            maxDistance
        )
        : getSubgraphByDistance(traversalGraph, resolvedParentNodeId, maxDistance)

    // 3. PURE: Convert subgraph to ASCII visualization
    // Make edges bidirectional so parents are shown as "children" in the tree.
    // This ensures nodes reachable via incoming edges (parents) appear in the ASCII tree,
    // not just nodes reachable via outgoing edges (children).
    const bidirectionalSubgraph: Graph = makeBidirectionalEdges(subgraph)
    const asciiTree: string = graphToAscii(bidirectionalSubgraph, resolvedParentNodeId)

    // 4. EDGE: Generate unique context node ID
    const timestamp: number = dependencies.clock.now()
    const parentIdWithoutExtension: string = resolvedParentNodeId.replace(/\.md$/, '')
    // Don't prepend ctx-nodes/ if the parent path already contains it (prevents infinite nesting)
    // Note: nodeIds are now relative to projectRoot (e.g., "monday/ctx-nodes/...")
    const alreadyInContextFolder: boolean = parentIdWithoutExtension.includes(`/${CONTEXT_NODES_FOLDER}/`)
        || parentIdWithoutExtension.startsWith(`${CONTEXT_NODES_FOLDER}/`)

    // Get write path (absolute) to properly construct context node path
    // Context nodes go in {writeFolderPath}/ctx-nodes/
    const candidateContextNodeId: string = alreadyInContextFolder
        ? `${parentIdWithoutExtension}_context_${timestamp}.md`
        : `${writeFolderPath}/${CONTEXT_NODES_FOLDER}/${path.basename(parentIdWithoutExtension)}_context_${timestamp}.md`
    // Ensure unique ID by appending _2, _3, etc. if collision exists
    const existingIds: ReadonlySet<string> = new Set(Object.keys(currentGraph.nodes))
    const contextNodeId: string = ensureUniqueNodeId(candidateContextNodeId, existingIds)

    // 5. EDGE: Get parent node info for context
    const parentTitle: string = getNodeTitle(parentNode)

    // 6. EDGE: Build markdown content with frontmatter
    // Context node is orphaned (no edges to task node) - terminal shadow will connect to it
    const contextMaxChars: number = settings.contextMaxChars
    const content: string = buildContextNodeContent(
        resolvedParentNodeId,
        parentTitle,
        maxDistance,
        asciiTree,
        bidirectionalSubgraph,
        validSemanticNodeIds,
        contextMaxChars
    )

    // 7. PURE: Create orphaned context node (no parent edge)
    // The terminal's shadow node will create a cytoscape edge to this context node
    const parsedNode: GraphNode = parseMarkdownToGraphNode(content, contextNodeId, currentGraph)
    const contextNode: GraphNode = {
        kind: 'leaf',
        absoluteFilePathIsID: contextNodeId,
        outgoingEdges: parsedNode.outgoingEdges,
        contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            ...parsedNode.nodeUIMetadata,
            position: calculateInitialPositionForChild(parentNode, currentGraph, undefined, 100),
        },
    }
    const contextNodeDelta: GraphDelta = [
        {
            type: 'UpsertNode',
            nodeToUpsert: contextNode,
            previousNode: O.none
        }
    ]

    // 8. EDGE: Apply via GraphDelta pipeline (writes to disk)
    await applyGraphDeltaToDBThroughMemAndUIAndEditors(contextNodeDelta)

    // 9. Return the created node ID
    return contextNodeId
}

/**
 * Builds the markdown content for a context node
 */
function buildContextNodeContent(
    parentNodeId: NodeIdAndFilePath,
    _parentTitle: string,
    _maxDistance: number,
    asciiTree: string,
    subgraph: Graph,
    semanticNodeIds: readonly NodeIdAndFilePath[],
    contextMaxChars?: number
): string {
    // todo this should be done by creatingGraphNode, and then calling to markdown function on it.
    const nodeDetailsList: string = generateNodeDetailsList(subgraph, parentNodeId, semanticNodeIds, contextMaxChars)

    // Collect all node IDs from the subgraph (excluding context nodes to prevent self-referencing)
    const containedNodeIds: readonly string[] = Object.keys(subgraph.nodes)
        .filter(nodeId => !subgraph.nodes[nodeId].nodeUIMetadata.isContextNode)

    // Format containedNodeIds as YAML array
    const containedNodeIdsYaml: string = containedNodeIds.length > 0
        ? `containedNodeIds:\n${containedNodeIds.map(id => `  - ${id}`).join('\n')}\n`
        : ''

    // Context node is orphaned - no wikilink edge to parent
    // The terminal's shadow node will create a cytoscape edge to this context node
    return `---
title: "ctx"
isContextNode: true
${containedNodeIdsYaml}---
# ctx
Nearby nodes to: ${parentNodeId}
\`\`\`
${asciiTree}
\`\`\`

## Node Contents
${nodeDetailsList}

`
}

/**
 * Escape wikilink markers so they don't create edges when written to disk.
 * Converts [link]* markers to [\[link]\]
 */
function escapeWikilinkMarkers(content: string): string {
    return content.replace(/\[([^\]]+)\]\*/g, '[\\[$1]\\]')
}

/**
 * Per-node preview budget decays with graph distance from the task node along
 * a sigmoid curve: stays near the ceiling for the first few hops, drops fast
 * through the inflection point around hops=7, then asymptotes to the floor.
 *   maxLines(hops) = max(15, round(15 + 385 / (1 + exp(0.7 * (hops - 7)))))
 * Ceiling ~400 lines at hop 1, floor 15 lines at large hops.
 * @internal Exported for testing only.
 */
export function maxPreviewLinesForHops(hops: number): number {
    if (!Number.isFinite(hops) || hops < 1) return 15
    return Math.max(15, Math.round(15 + 385 / (1 + Math.exp(0.7 * (hops - 7)))))
}

/**
 * Get a compact summary for a neighbor node.
 * Includes the first `maxLines` non-empty lines of content.
 * Prepends YAML `summary` field if it exists.
 */
function getNodeSummaryContent(node: GraphNode, escapedContent: string, maxLines: number): string {
    const summary: string | undefined = node.nodeUIMetadata.additionalYAMLProps['summary']
    const nonEmptyLines: string[] = escapedContent.split('\n').filter((l: string) => l.trim().length > 0)
    const preview: string = nonEmptyLines.slice(0, maxLines).join('\n')
    const omitted: number = nonEmptyLines.length - maxLines
    const previewWithOmitted: string = omitted > 0 ? `${preview}\n  ...${omitted} additional lines` : preview
    return summary ? `${summary}\n  ${previewWithOmitted}` : previewWithOmitted
}

/**
 * Compute shortest-path distances from startNodeId to all other nodes in the subgraph.
 * Traverses both outgoing and incoming edges (undirected BFS via makeBidirectionalEdges).
 * Nodes not reachable return Infinity.
 */
function computeNodeDistances(
    bidirectionalSubgraph: Graph,
    startNodeId: NodeIdAndFilePath
): ReadonlyMap<string, number> {
    const distances: Map<string, number> = new Map()
    if (!bidirectionalSubgraph.nodes[startNodeId]) return distances

    distances.set(startNodeId, 0)
    const queue: Array<{id: string; dist: number}> = [{id: startNodeId, dist: 0}]

    while (queue.length > 0) {
        const item: {id: string; dist: number} | undefined = queue.shift()
        if (!item) break
        const {id, dist} = item
        const node: GraphNode | undefined = bidirectionalSubgraph.nodes[id]
        if (!node) continue
        for (const edge of node.outgoingEdges) {
            if (!distances.has(edge.targetId)) {
                distances.set(edge.targetId, dist + 1)
                queue.push({id: edge.targetId, dist: dist + 1})
            }
        }
    }

    return distances
}

/**
 * Generate markdown list of node details, ranked by relevance and budget-constrained.
 *
 * Tiered content strategy:
 * - Task node (startNodeId): full content, untruncated, in <TASK> tag (recency bias)
 * - All neighbor nodes: hop-decayed preview (sigmoid, ceiling ~400, floor 15 lines) + YAML summary + filepath
 * - Over-budget nodes: title + filepath only
 *
 * Sort order: semantic matches first, then by graph distance (closer nodes first).
 * Total output capped at contextMaxChars (~8K default).
 * @internal Exported for testing only.
 */
export function generateNodeDetailsList(
    subgraph: Graph,
    _startNodeId: NodeIdAndFilePath,
    semanticNodeIds: readonly NodeIdAndFilePath[],
    contextMaxChars?: number
): string {
    const budget: number = contextMaxChars ?? 800000
    const semanticSet: ReadonlySet<string> = new Set(semanticNodeIds)
    const distances: ReadonlyMap<string, number> = computeNodeDistances(subgraph, _startNodeId)

    // Collect non-context, non-start nodes and sort:
    // primary = semantic first, secondary = graph distance ascending (closer = higher priority)
    const nodeIds: readonly string[] = Object.keys(subgraph.nodes)
        .filter((nodeId: string) => {
            const node: GraphNode = subgraph.nodes[nodeId]
            return !node.nodeUIMetadata.isContextNode && nodeId !== _startNodeId
        })
        .sort((a: string, b: string) => {
            const aSemantic: boolean = semanticSet.has(a)
            const bSemantic: boolean = semanticSet.has(b)
            if (aSemantic && !bSemantic) return -1
            if (!aSemantic && bSemantic) return 1
            const aDist: number = distances.get(a) ?? Infinity
            const bDist: number = distances.get(b) ?? Infinity
            return aDist - bDist
        })

    // Reserve space for the task node (untruncated) + agent instructions
    const startNodeContent: string = escapeWikilinkMarkers(
        subgraph.nodes[_startNodeId].contentWithoutYamlOrLinks
    )
    const taskBlock: string = `<TASK> IMPORTANT. YOUR specific task, and the most relevant context is the source note you were spawned from, which is:
        ${_startNodeId}: ${startNodeContent} </TASK>`
    const reservedChars: number = taskBlock.length

    // Fill neighbor node summaries within remaining budget
    let usedChars: number = reservedChars
    const lines: string[] = []
    const excludedNodeIds: string[] = []

    for (const nodeId of nodeIds) {
        const node: GraphNode = subgraph.nodes[nodeId]
        const title: string = getNodeTitle(node)
        const isSemantic: boolean = semanticSet.has(nodeId)
        const marker: string = isSemantic ? ' [SEMANTIC]' : ''
        const rawContent: string = escapeWikilinkMarkers(node.contentWithoutYamlOrLinks)
        // Neighbor preview length decays with hop distance from task node (sigmoid, floor 15 lines).
        // [SEMANTIC] marker preserved so agents know which nodes came from vector search.
        const hops: number = distances.get(nodeId) ?? Infinity
        const maxLines: number = maxPreviewLinesForHops(hops)
        const nodeContent: string = getNodeSummaryContent(node, rawContent, maxLines)
        const line: string = `- **${title}**${marker} (${nodeId})\n  ${nodeContent}`

        if (usedChars + line.length > budget) {
            excludedNodeIds.push(nodeId)
            continue
        }

        lines.push(line)
        usedChars += line.length
    }

    // Append excluded nodes as title-only references (cheap, still useful for navigation)
    if (excludedNodeIds.length > 0) {
        const titles: string = excludedNodeIds
            .map((id: string) => {
                const node: GraphNode = subgraph.nodes[id]
                return `- ${getNodeTitle(node)}: ${id}`
            })
            .join('\n')
        lines.push(`\n<ADDITIONAL_NEARBY_NODES count="${excludedNodeIds.length}" note="Content omitted — use get_unseen_nodes_nearby or read the file directly">\n${titles}\n</ADDITIONAL_NEARBY_NODES>`)
    }

    // Task node always last (benefits from recency bias in LLM attention)
    lines.push(taskBlock)

    return lines.join('\n')
}
