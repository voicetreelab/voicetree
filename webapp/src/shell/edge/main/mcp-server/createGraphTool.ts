/**
 * MCP Tool: create_graph
 * Creates a graph of progress nodes in a single call.
 * Accepts a JSON graph of fully populated nodes with support for multiple parents
 * (DAG structure including diamond dependencies). Creates all files atomically,
 * returns paths + warnings. Accept-all, warn-on-error — never blocks creation.
 *
 * Replaces multi-call add_progress_node workflows where agents had to create
 * nodes sequentially (O(depth) round-trips). Now one call creates the whole graph.
 */

import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position} from '@/pure/graph'
import {findBestMatchingNode} from '@/pure/graph/markdown-parsing/extract-edges'
import {ensureUniqueNodeId} from '@/pure/graph/ensureUniqueNodeId'
import {parseMarkdownToGraphNode} from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {type McpToolResponse, buildJsonResponse} from './types'
import {
    type ComplexityScore,
    type MermaidBlock,
    buildMarkdownBody,
    countBodyLines,
    slugify,
    validateMermaidBlocks,
    extractMermaidBlocks,
    parseDiagramParam,
} from './addProgressNodeTool'
import {loadSettings} from '@/shell/edge/main/settings/settings_IO'
import type {VTSettings} from '@/pure/settings/types'

export interface CreateGraphNodeInput {
    readonly filename: string
    readonly title: string
    readonly summary: string
    readonly content?: string
    readonly color?: string
    readonly diagram?: string
    readonly notes?: readonly string[]
    readonly codeDiffs?: readonly string[]
    readonly filesChanged?: readonly string[]
    readonly complexityScore?: ComplexityScore
    readonly complexityExplanation?: string
    readonly linkedArtifacts?: readonly string[]
    readonly parents?: readonly string[]
}

export interface CreateGraphParams {
    readonly callerTerminalId: string
    readonly parentNodeId?: string
    readonly nodes: readonly CreateGraphNodeInput[]
}

/**
 * Detect cycles in parent references using DFS.
 * Supports multiple parents per node (DAG validation).
 * Returns true if a cycle exists.
 */
function hasCycle(nodes: readonly CreateGraphNodeInput[]): boolean {
    const adjacency: Map<string, string[]> = new Map()
    for (const node of nodes) {
        if (node.parents) {
            for (const parentId of node.parents) {
                const children: string[] = adjacency.get(parentId) ?? []
                children.push(node.filename)
                adjacency.set(parentId, children)
            }
        }
    }

    const visited: Set<string> = new Set()
    const inStack: Set<string> = new Set()

    function dfs(nodeId: string): boolean {
        if (inStack.has(nodeId)) return true
        if (visited.has(nodeId)) return false

        visited.add(nodeId)
        inStack.add(nodeId)

        for (const child of adjacency.get(nodeId) ?? []) {
            if (dfs(child)) return true
        }

        inStack.delete(nodeId)
        return false
    }

    for (const node of nodes) {
        if (!visited.has(node.filename)) {
            if (dfs(node.filename)) return true
        }
    }

    return false
}

/**
 * Topological sort of nodes by parent dependencies.
 * All parents come before their children in the output.
 * Supports multiple parents per node.
 */
function topologicalSort(nodes: readonly CreateGraphNodeInput[]): CreateGraphNodeInput[] {
    const nodeMap: Map<string, CreateGraphNodeInput> = new Map()
    for (const node of nodes) {
        nodeMap.set(node.filename, node)
    }

    const visited: Set<string> = new Set()
    const result: CreateGraphNodeInput[] = []

    function visit(nodeId: string): void {
        if (visited.has(nodeId)) return
        visited.add(nodeId)

        const node: CreateGraphNodeInput | undefined = nodeMap.get(nodeId)
        if (!node) return

        // Visit ALL parents before this node
        if (node.parents) {
            for (const parentId of node.parents) {
                if (nodeMap.has(parentId)) {
                    visit(parentId)
                }
            }
        }

        result.push(node)
    }

    for (const node of nodes) {
        visit(node.filename)
    }

    return result
}

interface CreatedNodeInfo {
    readonly nodeId: NodeIdAndFilePath
    readonly baseName: string
}

type NodeResult = {
    readonly id: string
    readonly path: string
    readonly status: 'ok' | 'warning'
    readonly warning?: string
}

export async function createGraphTool({
    callerTerminalId,
    parentNodeId: graphParentId,
    nodes,
}: CreateGraphParams): Promise<McpToolResponse> {
    // Validate caller terminal
    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    const callerRecord: TerminalRecord | undefined = terminalRecords.find(
        (record: TerminalRecord) => record.terminalId === callerTerminalId
    )
    if (!callerRecord) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    // Get vault path
    const vaultPathOpt: O.Option<string> = await getWritePath()
    if (O.isNone(vaultPathOpt)) {
        return buildJsonResponse({
            success: false,
            error: 'No vault loaded. Please load a folder in the UI first.'
        }, true)
    }
    const writePath: string = vaultPathOpt.value

    // Validate: at least 1 node
    if (nodes.length < 1) {
        return buildJsonResponse({
            success: false,
            error: 'create_graph requires at least 1 node.'
        }, true)
    }

    // Validate: each node has filename + title + summary
    for (const node of nodes) {
        if (!node.filename) {
            return buildJsonResponse({
                success: false,
                error: 'Every node must have a filename field.'
            }, true)
        }
        if (!node.title || !node.summary) {
            return buildJsonResponse({
                success: false,
                error: `Node "${node.filename}" is missing required fields: title and summary.`
            }, true)
        }
    }

    // Validate: unique filenames
    const filenames: Set<string> = new Set()
    for (const node of nodes) {
        if (filenames.has(node.filename)) {
            return buildJsonResponse({
                success: false,
                error: `Duplicate filename: "${node.filename}".`
            }, true)
        }
        filenames.add(node.filename)
    }

    // Validate: every parent references a declared filename
    for (const node of nodes) {
        if (node.parents) {
            for (const parentRef of node.parents) {
                if (!filenames.has(parentRef)) {
                    return buildJsonResponse({
                        success: false,
                        error: `Node "${node.filename}" references parent "${parentRef}" which is not a declared filename in this call.`
                    }, true)
                }
            }
        }
    }

    // Validate: no cycles
    if (hasCycle(nodes)) {
        return buildJsonResponse({
            success: false,
            error: 'Cycle detected in parent references.'
        }, true)
    }

    // Validate: codeDiffs require complexity
    for (const node of nodes) {
        const hasCodeDiffs: boolean = node.codeDiffs !== undefined && node.codeDiffs.length > 0
        if (hasCodeDiffs && (!node.complexityScore || !node.complexityExplanation)) {
            return buildJsonResponse({
                success: false,
                error: `Node "${node.filename}": complexityScore and complexityExplanation are required when codeDiffs are provided.`
            }, true)
        }
    }

    const graph: Graph = getGraph()

    // Resolve graph parent (attachment point for root nodes)
    const defaultParentId: string = O.isSome(callerRecord.terminalData.anchoredToNodeId)
        ? callerRecord.terminalData.anchoredToNodeId.value
        : callerRecord.terminalData.attachedToContextNodeId
    const rawParentId: string = graphParentId ?? defaultParentId
    const resolvedGraphParentId: NodeIdAndFilePath | undefined = graph.nodes[rawParentId]
        ? rawParentId
        : findBestMatchingNode(rawParentId, graph.nodes, graph.nodeByBaseName)

    if (!resolvedGraphParentId || !graph.nodes[resolvedGraphParentId]) {
        return buildJsonResponse({
            success: false,
            error: `Parent node ${rawParentId} not found in graph.`
        }, true)
    }

    const graphParentNode: GraphNode = graph.nodes[resolvedGraphParentId]
    const graphParentPosition: Position = O.getOrElse(() => ({x: 0, y: 0}))(graphParentNode.nodeUIMetadata.position)
    const graphParentBaseName: string = resolvedGraphParentId.split('/').pop()?.replace(/\.md$/, '') ?? resolvedGraphParentId

    // Agent info from terminal record
    const agentName: string = callerRecord.terminalData.agentName
    const defaultColor: string = callerRecord.terminalData.initialEnvVars?.['AGENT_COLOR'] ?? 'blue'

    // Pre-validate line lengths: block ALL creation if any node is too long
    const settings: VTSettings = await loadSettings()
    const lineLimit: number = settings.nodeLineLimit ?? 70
    for (const node of nodes) {
        const bodyLines: number = countBodyLines(node.summary, node.content)
        if (bodyLines > lineLimit) {
            return buildJsonResponse({
                success: false,
                error: `Node "${node.filename}" is too long (${bodyLines} lines, limit is ${lineLimit}). Split into a TREE of nodes that mirrors the conceptual structure of your content — use the \`parents\` field to create branching, not a linear chain.\n\nSplit by concern:\nTask: Review git diff\n├── Review: Collision-aware positioning refactor\n└── Review: Prompt template cleanup\n\nSplit by phase + option:\nTask\n├── High-level architecture\n│   ├── Option A: Event-driven\n│   └── Option B: Request-response\n├── Data types\n└── Pure functions`
            }, true)
        }
    }

    // Topological sort: all parents before children
    const sortedNodes: CreateGraphNodeInput[] = topologicalSort(nodes)

    // Track created nodes for position and wikilink resolution
    const createdNodes: Map<string, CreatedNodeInfo> = new Map()
    const createdPositions: Map<string, Position> = new Map()
    const childCounts: Map<string, number> = new Map()
    const existingIds: Set<string> = new Set(Object.keys(graph.nodes))
    const allNewNodeIds: NodeIdAndFilePath[] = []
    const results: NodeResult[] = []

    for (const node of sortedNodes) {
        // Determine parent(s) for wikilinks and positioning
        const parentBaseNames: string[] = []
        let deepestParentPosition: Position = graphParentPosition

        if (node.parents && node.parents.length > 0) {
            for (const parentRef of node.parents) {
                const parentInfo: CreatedNodeInfo | undefined = createdNodes.get(parentRef)
                if (parentInfo) {
                    parentBaseNames.push(parentInfo.baseName)
                    const parentPos: Position = createdPositions.get(parentRef) ?? graphParentPosition
                    // Use the rightmost (deepest) parent for x positioning
                    if (parentPos.x > deepestParentPosition.x) {
                        deepestParentPosition = parentPos
                    }
                }
            }
        }

        // Root nodes (no local parents) attach to the graph parent
        if (parentBaseNames.length === 0) {
            parentBaseNames.push(graphParentBaseName)
            deepestParentPosition = graphParentPosition
        }

        // Spread children of the same parent set vertically
        // For multi-parent nodes, key on the first parent
        const parentKey: string = (node.parents && node.parents.length > 0) ? node.parents[0] : '__graph_root__'
        const childIndex: number = childCounts.get(parentKey) ?? 0
        childCounts.set(parentKey, childIndex + 1)

        const nodePosition: Position = {
            x: deepestParentPosition.x + 200,
            y: deepestParentPosition.y + (childIndex * 150)
        }

        // Build markdown with multiple parent wikilinks
        const markdownContent: string = buildMarkdownBody({
            title: node.title,
            summary: node.summary,
            content: node.content,
            codeDiffs: node.codeDiffs,
            filesChanged: node.filesChanged,
            diagram: node.diagram,
            notes: node.notes,
            linkedArtifacts: node.linkedArtifacts,
            complexityScore: node.complexityScore,
            complexityExplanation: node.complexityExplanation,
            color: node.color ?? defaultColor,
            agentName,
            parentBaseNames,
        })

        // Validate mermaid (non-blocking — warning only)
        let warning: string | undefined
        const allMermaidBlocks: MermaidBlock[] = []
        if (node.content) {
            allMermaidBlocks.push(...extractMermaidBlocks(node.content))
        }
        if (node.diagram) {
            const diagramBlock: MermaidBlock = parseDiagramParam(node.diagram)
            allMermaidBlocks.push({...diagramBlock, index: allMermaidBlocks.length})
        }
        if (allMermaidBlocks.length > 0) {
            const validationError: string | null = await validateMermaidBlocks(allMermaidBlocks)
            if (validationError) {
                warning = validationError
            }
        }

        // Generate unique node ID from filename (strip .md if provided)
        const rawFilename: string = node.filename.replace(/\.md$/, '')
        const nodeSlug: string = slugify(rawFilename)
        const candidateId: string = `${writePath}/${nodeSlug || 'graph-node'}.md`
        const nodeId: NodeIdAndFilePath = ensureUniqueNodeId(candidateId, existingIds)
        existingIds.add(nodeId)

        const baseName: string = nodeId.split('/').pop()?.replace(/\.md$/, '') ?? nodeSlug

        try {
            const currentGraph: Graph = getGraph()
            const parsedNode: GraphNode = parseMarkdownToGraphNode(markdownContent, nodeId, currentGraph)

            const progressNode: GraphNode = {
                absoluteFilePathIsID: nodeId,
                outgoingEdges: parsedNode.outgoingEdges,
                contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
                nodeUIMetadata: {
                    ...parsedNode.nodeUIMetadata,
                    position: O.some(nodePosition),
                }
            }

            const delta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: progressNode,
                previousNode: O.none,
            }]

            await applyGraphDeltaToDBThroughMemAndUIAndEditors(delta)

            allNewNodeIds.push(nodeId)
            createdNodes.set(node.filename, {nodeId, baseName})
            createdPositions.set(node.filename, nodePosition)

            results.push({
                id: nodeId,
                path: nodeId,
                status: warning ? 'warning' : 'ok',
                ...(warning ? {warning: `${warning} — fix at ${nodeId}`} : {}),
            })
        } catch (error: unknown) {
            const errorMessage: string = error instanceof Error ? error.message : String(error)
            results.push({
                id: nodeId,
                path: nodeId,
                status: 'warning',
                warning: `Creation failed: ${errorMessage}`,
            })
        }
    }

    // Update caller's context node to include all new node IDs
    try {
        const updatedGraph: Graph = getGraph()
        const callerContextNodeId: string = callerRecord.terminalData.attachedToContextNodeId
        const callerContextNode: GraphNode | undefined = updatedGraph.nodes[callerContextNodeId]
        if (callerContextNode?.nodeUIMetadata.containedNodeIds) {
            const updatedContainedNodeIds: readonly string[] = [
                ...callerContextNode.nodeUIMetadata.containedNodeIds,
                ...allNewNodeIds,
            ]
            const updatedContextNode: GraphNode = {
                ...callerContextNode,
                nodeUIMetadata: {
                    ...callerContextNode.nodeUIMetadata,
                    containedNodeIds: updatedContainedNodeIds,
                }
            }
            const contextDelta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: updatedContextNode,
                previousNode: O.some(callerContextNode),
            }]
            await applyGraphDeltaToDBThroughMemAndUIAndEditors(contextDelta)
        }
    } catch (_contextError: unknown) {
        // Non-fatal: context node update failed, nodes were still created
    }

    return buildJsonResponse({
        success: true,
        nodes: results,
        hint: 'To update a node, edit the file directly at its path. Do not call create_graph again for updates.',
    })
}
