/**
 * MCP Tool: create_graph
 * Creates a graph of progress nodes in a single call.
 * Pure types, DAG validation, and path resolution live in createGraphPure.ts.
 */

import path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import normalizePath from 'normalize-path'
import {applyGraphDeltaToGraph} from '@vt/graph-model/graph'
import type {Graph, GraphDelta, GraphNode, NodeDelta, NodeIdAndFilePath, Position} from '@vt/graph-model/graph'
import {ensureUniqueNodeId} from '@vt/graph-model/graph'
import {findBestMatchingNode, parseMarkdownToGraphNode} from '@vt/graph-model/markdown'
import {
    buildMarkdownBody,
    type ComplexityScore,
} from '@vt/graph-tools/node'
import {calculateNodePosition} from '@vt/graph-model/spatial'
import {buildSpatialIndexFromGraph} from '@vt/graph-model/spatial'
import type {SpatialIndex} from '@vt/graph-model/spatial'
import {getTerminalRecords, resetAuditRetryCount, type TerminalRecord} from '@vt/agent-runtime'
import {type McpToolResponse, buildJsonResponse} from './types'
import {
    type MermaidBlock,
    slugify,
    validateMermaidBlocks,
    extractMermaidBlocks,
    parseDiagramParam,
} from './addProgressNodeTool'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {
    type ValidationResult,
    type OverrideEntry,
    ALL_RULES,
    runValidations,
    resolveOverrides,
    formatViolationError,
} from './createGraphValidation'
import {registerAgentNodes} from './agentNodeIndex'
import {applyMcpGraphDelta, getMcpGraph, getMcpVaultPaths, getMcpWritePath} from './mcp-graph-bridge'
import {
    type ParentRef,
    parentRefFilename,
    parentRefEdgeLabel,
    hasCycle,
    topologicalSort,
} from './createGraphTopology'

export type {ParentRef}

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
    readonly parents?: readonly ParentRef[]
}

export interface CreateGraphParams {
    readonly callerTerminalId: string
    readonly parentNodeId?: string
    readonly outputPath?: string
    readonly nodes: readonly CreateGraphNodeInput[]
    readonly override_with_rationale?: readonly OverrideEntry[]
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

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

type ParentLink = {
    readonly baseName: string
    readonly edgeLabel: string | undefined
}

type ParentCandidate = {
    readonly link: ParentLink
    readonly position: Position
    readonly nodeId: NodeIdAndFilePath
}

type GraphParentContext = {
    readonly resolvedGraphParentId: NodeIdAndFilePath
    readonly graphParentPosition: Position
    readonly graphParentBaseName: string
}

type NodeParentContext = {
    readonly parentLinks: readonly ParentLink[]
    readonly deepestParentPosition: Position
    readonly deepestParentNodeId: NodeIdAndFilePath
}

type NodeDraft = {
    readonly node: CreateGraphNodeInput
    readonly nodeId: NodeIdAndFilePath
    readonly baseName: string
    readonly nodePosition: Position
    readonly markdownContent: string
    readonly warning: string | undefined
}

type NodeDeltaDraft = {
    readonly delta: NodeDelta[]
}

type BatchBuildResult = {
    readonly batchDelta: readonly NodeDelta[]
    readonly allNewNodeIds: readonly NodeIdAndFilePath[]
    readonly createdNodes: ReadonlyMap<string, CreatedNodeInfo>
    readonly results: readonly NodeResult[]
}

function errorResponse(error: string): McpToolResponse {
    return buildJsonResponse({success: false, error}, true)
}

function isPathWithinDirectory(targetPath: string, directoryPath: string): boolean {
    return targetPath === directoryPath || targetPath.startsWith(`${directoryPath}/`)
}

function resolveOutputDirectory(
    writePath: string,
    outputPath: string | undefined,
    allowedVaultPaths: readonly string[]
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string } {
    if (!outputPath || outputPath.trim() === '') {
        return {ok: true, path: normalizePath(writePath)}
    }

    const requestedPath: string = outputPath.trim()
    const resolvedPath: string = normalizePath(
        path.isAbsolute(requestedPath)
            ? requestedPath
            : path.resolve(writePath, requestedPath)
    )

    if (allowedVaultPaths.some((allowedPath: string) => isPathWithinDirectory(resolvedPath, allowedPath))) {
        return {ok: true, path: resolvedPath}
    }

    return {
        ok: false,
        error: `outputPath "${outputPath}" resolves to "${resolvedPath}" which is outside the loaded vault paths. Choose a path inside one of: ${allowedVaultPaths.join(', ')}`,
    }
}

function findCallerRecord(callerTerminalId: string): Result<TerminalRecord> {
    const callerRecord: TerminalRecord | undefined = getTerminalRecords().find(
        (record: TerminalRecord) => record.terminalId === callerTerminalId
    )
    if (!callerRecord) return {ok: false, error: `Unknown caller terminal: ${callerTerminalId}`}
    return {ok: true, value: callerRecord}
}

async function resolveConfiguredOutputDirectory(outputPath: string | undefined): Promise<Result<string>> {
    const vaultPathOpt: O.Option<string> = await getMcpWritePath()
    if (O.isNone(vaultPathOpt)) {
        return {ok: false, error: 'No vault loaded. Please load a folder in the UI first.'}
    }

    const writePath: string = vaultPathOpt.value
    const loadedVaultPaths: readonly string[] = await getMcpVaultPaths()
    const allowedVaultPaths: readonly string[] = (loadedVaultPaths.length > 0 ? loadedVaultPaths : [writePath])
        .map((vaultPath: string) => normalizePath(vaultPath))
    const outputDirectoryResolution = resolveOutputDirectory(writePath, outputPath, allowedVaultPaths)
    if (!outputDirectoryResolution.ok) return outputDirectoryResolution
    return {ok: true, value: outputDirectoryResolution.path}
}

function validateNodeInputs(nodes: readonly CreateGraphNodeInput[]): Result<Set<string>> {
    if (nodes.length < 1) return {ok: false, error: 'create_graph requires at least 1 node.'}

    const filenames: Set<string> = new Set()
    for (const node of nodes) {
        if (!node.filename) return {ok: false, error: 'Every node must have a filename field.'}
        if (!node.title || !node.summary) {
            return {ok: false, error: `Node "${node.filename}" is missing required fields: title and summary.`}
        }
        if (filenames.has(node.filename)) return {ok: false, error: `Duplicate filename: "${node.filename}".`}
        filenames.add(node.filename)
    }

    const parentReferenceError: string | null = findParentReferenceError(nodes, filenames)
    if (parentReferenceError) return {ok: false, error: parentReferenceError}
    if (hasCycle(nodes)) return {ok: false, error: 'Cycle detected in parent references.'}

    const diffComplexityError: string | null = findDiffComplexityError(nodes)
    if (diffComplexityError) return {ok: false, error: diffComplexityError}

    return {ok: true, value: filenames}
}

function findParentReferenceError(nodes: readonly CreateGraphNodeInput[], filenames: ReadonlySet<string>): string | null {
    for (const node of nodes) {
        for (const parentRef of node.parents ?? []) {
            const parentFilename: string = parentRefFilename(parentRef)
            if (!filenames.has(parentFilename)) {
                return `Node "${node.filename}" references parent "${parentFilename}" which is not a declared filename in this call.`
            }
        }
    }
    return null
}

function findDiffComplexityError(nodes: readonly CreateGraphNodeInput[]): string | null {
    for (const node of nodes) {
        const hasCodeDiffs: boolean = node.codeDiffs !== undefined && node.codeDiffs.length > 0
        if (hasCodeDiffs && (!node.complexityScore || !node.complexityExplanation)) {
            return `Node "${node.filename}": complexityScore and complexityExplanation are required when codeDiffs are provided.`
        }
    }
    return null
}

function defaultParentId(callerRecord: TerminalRecord): string {
    return O.isSome(callerRecord.terminalData.anchoredToNodeId)
        ? callerRecord.terminalData.anchoredToNodeId.value
        : callerRecord.terminalData.attachedToContextNodeId
}

function resolveGraphParent(
    graph: Graph,
    callerRecord: TerminalRecord,
    graphParentId: string | undefined
): Result<GraphParentContext> {
    const rawParentId: string = graphParentId ?? defaultParentId(callerRecord)
    const resolvedGraphParentId: NodeIdAndFilePath | undefined = graph.nodes[rawParentId]
        ? rawParentId
        : findBestMatchingNode(rawParentId, graph.nodes, graph.nodeByBaseName)

    if (!resolvedGraphParentId || !graph.nodes[resolvedGraphParentId]) {
        return {ok: false, error: `Parent node ${rawParentId} not found in graph.`}
    }

    const graphParentNode: GraphNode = graph.nodes[resolvedGraphParentId]
    return {
        ok: true,
        value: {
            resolvedGraphParentId,
            graphParentPosition: O.getOrElse(() => ({x: 0, y: 0}))(graphParentNode.nodeUIMetadata.position),
            graphParentBaseName: resolvedGraphParentId.split('/').pop()?.replace(/\.md$/, '') ?? resolvedGraphParentId,
        },
    }
}

async function validateOverridableRules(
    nodes: readonly CreateGraphNodeInput[],
    callerRecord: TerminalRecord,
    graph: Graph,
    resolvedParentNodeId: NodeIdAndFilePath,
    overrides: readonly OverrideEntry[] | undefined
): Promise<string | null> {
    const callerTaskNodeId: NodeIdAndFilePath | null =
        O.isSome(callerRecord.terminalData.anchoredToNodeId) ? callerRecord.terminalData.anchoredToNodeId.value : null
    const settings: VTSettings = await loadSettings()
    const validationResult: ValidationResult = runValidations(ALL_RULES, {
        nodes,
        resolvedParentNodeId,
        callerTaskNodeId,
        graph,
        lineLimit: settings.nodeLineLimit ?? 70,
    })
    if (validationResult.status !== 'violations') return null

    const {unresolved} = resolveOverrides(validationResult.violations, overrides ?? [])
    return unresolved.length > 0 ? formatViolationError(unresolved) : null
}

function parentCandidateFor(
    parentRef: ParentRef,
    createdNodes: ReadonlyMap<string, CreatedNodeInfo>,
    createdPositions: ReadonlyMap<string, Position>,
    graphParentPosition: Position
): ParentCandidate | null {
    const parentFilename: string = parentRefFilename(parentRef)
    const parentInfo: CreatedNodeInfo | undefined = createdNodes.get(parentFilename)
    if (!parentInfo) return null

    return {
        link: {
            baseName: parentInfo.baseName,
            edgeLabel: parentRefEdgeLabel(parentRef),
        },
        position: createdPositions.get(parentFilename) ?? graphParentPosition,
        nodeId: parentInfo.nodeId,
    }
}

function selectRightmostParent(current: ParentCandidate, candidate: ParentCandidate): ParentCandidate {
    return candidate.position.x > current.position.x ? candidate : current
}

function resolveNodeParents(
    node: CreateGraphNodeInput,
    createdNodes: ReadonlyMap<string, CreatedNodeInfo>,
    createdPositions: ReadonlyMap<string, Position>,
    graphParent: GraphParentContext
): NodeParentContext {
    const candidates: readonly ParentCandidate[] = (node.parents ?? [])
        .map(parentRef => parentCandidateFor(parentRef, createdNodes, createdPositions, graphParent.graphParentPosition))
        .filter((candidate): candidate is ParentCandidate => candidate !== null)

    if (candidates.length === 0) {
        return {
            parentLinks: [{baseName: graphParent.graphParentBaseName, edgeLabel: undefined}],
            deepestParentPosition: graphParent.graphParentPosition,
            deepestParentNodeId: graphParent.resolvedGraphParentId,
        }
    }

    const deepestParent: ParentCandidate = candidates.reduce(selectRightmostParent)
    return {
        parentLinks: candidates.map(candidate => candidate.link),
        deepestParentPosition: deepestParent.position,
        deepestParentNodeId: deepestParent.nodeId,
    }
}

function calculateProgressNodePosition(localGraph: Graph, parentContext: NodeParentContext): Position {
    const spatialIndex: SpatialIndex = buildSpatialIndexFromGraph(localGraph)
    return O.getOrElse(() => parentContext.deepestParentPosition)(
        calculateNodePosition(localGraph, spatialIndex, parentContext.deepestParentNodeId)
    )
}

function buildNodeMarkdown(
    node: CreateGraphNodeInput,
    parentLinks: readonly ParentLink[],
    agentName: string,
    defaultColor: string
): string {
    return buildMarkdownBody({
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
        parentLinks,
    })
}

function mermaidBlocksForNode(node: CreateGraphNodeInput): MermaidBlock[] {
    const contentBlocks: MermaidBlock[] = node.content ? [...extractMermaidBlocks(node.content)] : []
    if (!node.diagram) return contentBlocks

    const diagramBlock: MermaidBlock = parseDiagramParam(node.diagram)
    return [...contentBlocks, {...diagramBlock, index: contentBlocks.length}]
}

async function mermaidWarningForNode(node: CreateGraphNodeInput): Promise<string | undefined> {
    const allMermaidBlocks: MermaidBlock[] = mermaidBlocksForNode(node)
    if (allMermaidBlocks.length === 0) return undefined

    return await validateMermaidBlocks(allMermaidBlocks) ?? undefined
}

function reserveNodeId(
    filename: string,
    outputDirectory: string,
    existingIds: Set<string>
): CreatedNodeInfo {
    const rawFilename: string = filename.replace(/\.md$/, '')
    const nodeSlug: string = slugify(rawFilename)
    const candidateId: string = normalizePath(path.join(outputDirectory, `${nodeSlug || 'graph-node'}.md`))
    const nodeId: NodeIdAndFilePath = ensureUniqueNodeId(candidateId, existingIds)
    existingIds.add(nodeId)

    return {
        nodeId,
        baseName: nodeId.split('/').pop()?.replace(/\.md$/, '') ?? nodeSlug,
    }
}

function draftNodeDelta(draft: NodeDraft, localGraph: Graph): Result<NodeDeltaDraft> {
    try {
        const parsedNode: GraphNode = parseMarkdownToGraphNode(draft.markdownContent, draft.nodeId, localGraph)
        const progressNode: GraphNode = {
            ...parsedNode,
            absoluteFilePathIsID: draft.nodeId,
            nodeUIMetadata: {
                ...parsedNode.nodeUIMetadata,
                position: O.some(draft.nodePosition),
            }
        }

        return {
            ok: true,
            value: {
                delta: [{
                    type: 'UpsertNode',
                    nodeToUpsert: progressNode,
                    previousNode: O.none,
                }],
            },
        }
    } catch (error: unknown) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return {ok: false, error: `Creation failed: ${errorMessage}`}
    }
}

async function buildNodeDraft(
    node: CreateGraphNodeInput,
    localGraph: Graph,
    outputDirectory: string,
    existingIds: Set<string>,
    createdNodes: ReadonlyMap<string, CreatedNodeInfo>,
    createdPositions: ReadonlyMap<string, Position>,
    graphParent: GraphParentContext,
    agentName: string,
    defaultColor: string
): Promise<NodeDraft> {
    const parentContext: NodeParentContext = resolveNodeParents(node, createdNodes, createdPositions, graphParent)
    const nodePosition: Position = calculateProgressNodePosition(localGraph, parentContext)
    const createdInfo: CreatedNodeInfo = reserveNodeId(node.filename, outputDirectory, existingIds)

    return {
        node,
        nodeId: createdInfo.nodeId,
        baseName: createdInfo.baseName,
        nodePosition,
        markdownContent: buildNodeMarkdown(node, parentContext.parentLinks, agentName, defaultColor),
        warning: await mermaidWarningForNode(node),
    }
}

function nodeSuccessResult(draft: NodeDraft): NodeResult {
    return {
        id: draft.nodeId,
        path: draft.nodeId,
        status: draft.warning ? 'warning' : 'ok',
        ...(draft.warning ? {warning: `${draft.warning} — fix at ${draft.nodeId}`} : {}),
    }
}

function nodeFailureResult(draft: NodeDraft, warning: string): NodeResult {
    return {
        id: draft.nodeId,
        path: draft.nodeId,
        status: 'warning',
        warning,
    }
}

async function buildNodeBatch(
    sortedNodes: readonly CreateGraphNodeInput[],
    graph: Graph,
    outputDirectory: string,
    graphParent: GraphParentContext,
    agentName: string,
    defaultColor: string
): Promise<BatchBuildResult> {
    let localGraph: Graph = graph
    const batchDelta: NodeDelta[] = []
    const existingIds: Set<string> = new Set(Object.keys(graph.nodes))
    const allNewNodeIds: NodeIdAndFilePath[] = []
    const createdNodes: Map<string, CreatedNodeInfo> = new Map()
    const createdPositions: Map<string, Position> = new Map()
    const results: NodeResult[] = []

    for (const node of sortedNodes) {
        const draft: NodeDraft = await buildNodeDraft(
            node, localGraph, outputDirectory, existingIds, createdNodes, createdPositions, graphParent, agentName, defaultColor
        )
        const deltaDraft: Result<NodeDeltaDraft> = draftNodeDelta(draft, localGraph)
        if (!deltaDraft.ok) {
            results.push(nodeFailureResult(draft, deltaDraft.error))
            continue
        }

        batchDelta.push(...deltaDraft.value.delta)
        localGraph = applyGraphDeltaToGraph(localGraph, deltaDraft.value.delta)
        allNewNodeIds.push(draft.nodeId)
        createdNodes.set(node.filename, {nodeId: draft.nodeId, baseName: draft.baseName})
        createdPositions.set(node.filename, draft.nodePosition)
        results.push(nodeSuccessResult(draft))
    }

    return {batchDelta, allNewNodeIds, createdNodes, results}
}

function createdAgentNodeRecords(
    sortedNodes: readonly CreateGraphNodeInput[],
    createdNodes: ReadonlyMap<string, CreatedNodeInfo>
): readonly { readonly nodeId: NodeIdAndFilePath; readonly title: string }[] {
    return sortedNodes.flatMap((node: CreateGraphNodeInput) => {
        const createdNode: CreatedNodeInfo | undefined = createdNodes.get(node.filename)
        return createdNode ? [{nodeId: createdNode.nodeId, title: node.title}] : []
    })
}

async function appendNodesToCallerContext(
    callerRecord: TerminalRecord,
    allNewNodeIds: readonly NodeIdAndFilePath[]
): Promise<void> {
    try {
        const updatedGraph: Graph = await getMcpGraph()
        const callerContextNodeId: string = callerRecord.terminalData.attachedToContextNodeId
        const callerContextNode: GraphNode | undefined = updatedGraph.nodes[callerContextNodeId]
        if (!callerContextNode?.nodeUIMetadata.containedNodeIds) return

        const updatedContextNode: GraphNode = {
            ...callerContextNode,
            nodeUIMetadata: {
                ...callerContextNode.nodeUIMetadata,
                containedNodeIds: [
                    ...callerContextNode.nodeUIMetadata.containedNodeIds,
                    ...allNewNodeIds,
                ],
            }
        }
        const contextDelta: GraphDelta = [{
            type: 'UpsertNode',
            nodeToUpsert: updatedContextNode,
            previousNode: O.some(callerContextNode),
        }]
        await applyMcpGraphDelta(contextDelta)
    } catch (_contextError: unknown) {
        // Non-fatal: context node update failed, nodes were still created
    }
}

export async function createGraphTool({
    callerTerminalId,
    parentNodeId: graphParentId,
    outputPath,
    nodes,
    override_with_rationale,
}: CreateGraphParams): Promise<McpToolResponse> {
    const callerRecordResult: Result<TerminalRecord> = findCallerRecord(callerTerminalId)
    if (!callerRecordResult.ok) return errorResponse(callerRecordResult.error)
    const callerRecord: TerminalRecord = callerRecordResult.value

    const outputDirectoryResult: Result<string> = await resolveConfiguredOutputDirectory(outputPath)
    if (!outputDirectoryResult.ok) return errorResponse(outputDirectoryResult.error)
    const outputDirectory: string = outputDirectoryResult.value

    const inputValidation: Result<Set<string>> = validateNodeInputs(nodes)
    if (!inputValidation.ok) return errorResponse(inputValidation.error)

    const graph: Graph = await getMcpGraph()

    const graphParentResult: Result<GraphParentContext> = resolveGraphParent(graph, callerRecord, graphParentId)
    if (!graphParentResult.ok) return errorResponse(graphParentResult.error)
    const graphParent: GraphParentContext = graphParentResult.value

    const agentName: string = callerRecord.terminalData.agentName
    const defaultColor: string = callerRecord.terminalData.initialEnvVars?.['AGENT_COLOR'] ?? 'blue'

    const validationError: string | null = await validateOverridableRules(
        nodes, callerRecord, graph, graphParent.resolvedGraphParentId, override_with_rationale
    )
    if (validationError) return errorResponse(validationError)

    const sortedNodes: CreateGraphNodeInput[] = topologicalSort(nodes)
    const batchResult: BatchBuildResult = await buildNodeBatch(
        sortedNodes, graph, outputDirectory, graphParent, agentName, defaultColor
    )

    if (batchResult.batchDelta.length > 0) {
        await applyMcpGraphDelta(batchResult.batchDelta)
    }

    registerAgentNodes(callerTerminalId, createdAgentNodeRecords(sortedNodes, batchResult.createdNodes))
    await appendNodesToCallerContext(callerRecord, batchResult.allNewNodeIds)

    resetAuditRetryCount(callerTerminalId)

    return buildJsonResponse({
        success: true,
        nodes: batchResult.results,
        hint: 'To update a node, edit the file directly at its path. Do not call create_graph again for updates.',
    })
}
