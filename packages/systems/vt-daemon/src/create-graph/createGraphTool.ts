/**
 * MCP Tool: create_graph
 * Creates a graph of progress nodes in a single call.
 *
 * Pure types live in createGraphTypes.ts; DAG validation (cycle detection and
 * topological sort over parent refs declared in each node's content body) in
 * createGraphTopology.ts; markdown body construction in
 * @vt/graph-tools/node's filesystemAuthoring. Parent edges are authored as
 * `- parent [[name|edge-label]]` lines inside `content` (no separate
 * `parents:[]` field).
 */

import path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import normalizePath from 'normalize-path'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {findBestMatchingNode} from '@vt/graph-model/markdown'
import {type McpToolResponse, buildJsonResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {
    type ValidationResult,
    ALL_RULES,
    runValidations,
    resolveOverrides,
    formatViolationError,
} from './createGraphValidation'
import type {OverrideEntry} from '@vt/graph-validation'
import {registerAgentNodes} from '../agent-runtime/agent-control/completion/agentNodeIndex.ts'
import {applyMcpGraphDelta, getMcpGraph, getMcpProjectPaths, getMcpWriteFolderPath} from '../config/graphBridge.ts'
import type {GraphBridge} from '../config/mcpBridges.ts'
import {
    hasCycle,
    topologicalSort,
} from './createGraphTopology'
import {buildNodeBatch} from './createGraphBatch'
import type {
    BatchBuildResult,
    CreatedNodeInfo,
    CreateGraphNodeInput,
    GraphParentContext,
    Result,
} from './createGraphTypes'
import {listTerminalRecords, resetTerminalAuditRetryCount, type TerminalRecord} from './createGraphRuntime'

export type {CreateGraphNodeInput}

export interface CreateGraphParams {
    readonly callerTerminalId: string
    readonly parentNodeId?: string
    readonly outputPath?: string
    readonly nodes: readonly CreateGraphNodeInput[]
    readonly override_with_rationale?: readonly OverrideEntry[]
}

function errorResponse(error: string): McpToolResponse {
    return buildJsonResponse({success: false, error}, true)
}

function isPathWithinDirectory(targetPath: string, directoryPath: string): boolean {
    return targetPath === directoryPath || targetPath.startsWith(`${directoryPath}/`)
}

function resolveOutputDirectory(
    writeFolderPath: string,
    outputPath: string | undefined,
    allowedProjectPaths: readonly string[]
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string } {
    if (!outputPath || outputPath.trim() === '') {
        return {ok: true, path: normalizePath(writeFolderPath)}
    }

    const requestedPath: string = outputPath.trim()
    const resolvedPath: string = normalizePath(
        path.isAbsolute(requestedPath)
            ? requestedPath
            : path.resolve(writeFolderPath, requestedPath)
    )

    if (allowedProjectPaths.some((allowedPath: string) => isPathWithinDirectory(resolvedPath, allowedPath))) {
        return {ok: true, path: resolvedPath}
    }

    return {
        ok: false,
        error: `outputPath "${outputPath}" resolves to "${resolvedPath}" which is outside the loaded project paths. Choose a path inside one of: ${allowedProjectPaths.join(', ')}`,
    }
}

function findCallerRecord(callerTerminalId: string): Result<TerminalRecord> {
    const callerRecord: TerminalRecord | undefined = listTerminalRecords().find(
        (record: TerminalRecord) => record.terminalId === callerTerminalId
    )
    if (!callerRecord) return {ok: false, error: `Unknown caller terminal: ${callerTerminalId}`}
    return {ok: true, value: callerRecord}
}

async function resolveConfiguredOutputDirectory(outputPath: string | undefined, bridge: GraphBridge): Promise<Result<string>> {
    const projectPathOpt: O.Option<string> = await getMcpWriteFolderPath(bridge)
    if (O.isNone(projectPathOpt)) {
        return {ok: false, error: 'No project loaded. Please load a folder in the UI first.'}
    }

    const writeFolderPath: string = projectPathOpt.value
    const loadedProjectPaths: readonly string[] = await getMcpProjectPaths(bridge)
    const allowedProjectPaths: readonly string[] = (loadedProjectPaths.length > 0 ? loadedProjectPaths : [writeFolderPath])
        .map((projectRoot: string) => normalizePath(projectRoot))
    const outputDirectoryResolution = resolveOutputDirectory(writeFolderPath, outputPath, allowedProjectPaths)
    if (!outputDirectoryResolution.ok) return outputDirectoryResolution
    return {ok: true, value: outputDirectoryResolution.path}
}

function validateNodeInputs(nodes: readonly CreateGraphNodeInput[]): Result<void> {
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

    if (hasCycle(nodes)) return {ok: false, error: 'Cycle detected in parent references.'}

    const diffComplexityError: string | null = findDiffComplexityError(nodes)
    if (diffComplexityError) return {ok: false, error: diffComplexityError}

    return {ok: true, value: undefined}
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

    return {
        ok: true,
        value: {
            resolvedGraphParentId,
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
    allNewNodeIds: readonly NodeIdAndFilePath[],
    bridge: GraphBridge,
): Promise<void> {
    try {
        const updatedGraph: Graph = await getMcpGraph(bridge)
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
        await applyMcpGraphDelta(bridge, contextDelta)
    } catch (_contextError: unknown) {
        // Non-fatal: context node update failed, nodes were still created
    }
}

export async function createGraphTool(
    {
        callerTerminalId,
        parentNodeId: graphParentId,
        outputPath,
        nodes,
        override_with_rationale,
    }: CreateGraphParams,
    bridge: GraphBridge,
): Promise<McpToolResponse> {
    const callerRecordResult: Result<TerminalRecord> = findCallerRecord(callerTerminalId)
    if (!callerRecordResult.ok) return errorResponse(callerRecordResult.error)
    const callerRecord: TerminalRecord = callerRecordResult.value

    const outputDirectoryResult: Result<string> = await resolveConfiguredOutputDirectory(outputPath, bridge)
    if (!outputDirectoryResult.ok) return errorResponse(outputDirectoryResult.error)
    const outputDirectory: string = outputDirectoryResult.value

    const inputValidation: Result<void> = validateNodeInputs(nodes)
    if (!inputValidation.ok) return errorResponse(inputValidation.error)

    const graph: Graph = await getMcpGraph(bridge)

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
        await applyMcpGraphDelta(bridge, batchResult.batchDelta)
    }

    registerAgentNodes(callerTerminalId, createdAgentNodeRecords(sortedNodes, batchResult.createdNodes))
    await appendNodesToCallerContext(callerRecord, batchResult.allNewNodeIds, bridge)

    resetTerminalAuditRetryCount(callerTerminalId)

    return buildJsonResponse({
        success: true,
        nodes: batchResult.results,
        hint: 'To update a node, edit the file directly at its path. Do not call create_graph again for updates.',
    })
}
