/**
 * MCP Tool: create_graph
 * Creates a graph of progress nodes in a single call.
 * Pure types, DAG validation, and path resolution live in createGraphPure.ts.
 */

import path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import normalizePath from 'normalize-path'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {findBestMatchingNode} from '@vt/graph-model/markdown'
import {tracing} from '@vt/observability'
import {type McpToolResponse, buildJsonResponse} from '../tools/toolResponse'
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
import {registerAgentNodes} from '../agents/agentNodeIndex'
import {applyMcpGraphDelta, getMcpGraphSnapshot} from '../config/mcp-graph-bridge'
import {
    parentRefFilename,
    hasCycle,
    topologicalSort,
} from './createGraphTopology'
import {buildNodeBatch} from './createGraphBatch'
import type {
    BatchBuildResult,
    CreatedNodeInfo,
    CreateGraphNodeInput,
    GraphParentContext,
    ParentRef,
    Result,
} from './createGraphTypes'
import {listTerminalRecords, resetTerminalAuditRetryCount, type TerminalRecord} from './createGraphRuntime'

export type {ParentRef}
export type {CreateGraphNodeInput}

export interface CreateGraphParams {
    readonly callerTerminalId: string
    readonly parentNodeId?: string
    readonly outputPath?: string
    readonly nodes: readonly CreateGraphNodeInput[]
    readonly override_with_rationale?: readonly OverrideEntry[]
}

type CreateGraphSnapshot = {
    readonly graph: Graph
    readonly projectRoot: string | null
    readonly vaultPaths: readonly string[]
    readonly writeFolder: string | null
}

function errorResponse(error: string): McpToolResponse {
    return buildJsonResponse({success: false, error}, true)
}

function isPathWithinDirectory(targetPath: string, directoryPath: string): boolean {
    return targetPath === directoryPath || targetPath.startsWith(`${directoryPath}/`)
}

function resolveOutputDirectory(
    writeFolder: string,
    outputPath: string | undefined,
    allowedVaultPaths: readonly string[]
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string } {
    if (!outputPath || outputPath.trim() === '') {
        return {ok: true, path: normalizePath(writeFolder)}
    }

    const requestedPath: string = outputPath.trim()
    const resolvedPath: string = normalizePath(
        path.isAbsolute(requestedPath)
            ? requestedPath
            : path.resolve(writeFolder, requestedPath)
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
    const callerRecord: TerminalRecord | undefined = listTerminalRecords().find(
        (record: TerminalRecord) => record.terminalId === callerTerminalId
    )
    if (!callerRecord) return {ok: false, error: `Unknown caller terminal: ${callerTerminalId}`}
    return {ok: true, value: callerRecord}
}

function resolveConfiguredOutputDirectory(
    snapshot: CreateGraphSnapshot,
    outputPath: string | undefined
): Result<string> {
    if (snapshot.writeFolder === null) {
        return {ok: false, error: 'No vault loaded. Please load a folder in the UI first.'}
    }

    const writeFolder: string = snapshot.writeFolder
    const allowedVaultPaths: readonly string[] = (snapshot.vaultPaths.length > 0 ? snapshot.vaultPaths : [writeFolder])
        .map((projectRoot: string) => normalizePath(projectRoot))
    const outputDirectoryResolution = resolveOutputDirectory(writeFolder, outputPath, allowedVaultPaths)
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

function createdAgentNodeRecords(
    sortedNodes: readonly CreateGraphNodeInput[],
    createdNodes: ReadonlyMap<string, CreatedNodeInfo>
): readonly { readonly nodeId: NodeIdAndFilePath; readonly title: string }[] {
    return sortedNodes.flatMap((node: CreateGraphNodeInput) => {
        const createdNode: CreatedNodeInfo | undefined = createdNodes.get(node.filename)
        return createdNode ? [{nodeId: createdNode.nodeId, title: node.title}] : []
    })
}

function buildCallerContextDelta(
    graph: Graph,
    callerRecord: TerminalRecord,
    allNewNodeIds: readonly NodeIdAndFilePath[]
): GraphDelta {
    const callerContextNodeId: string = callerRecord.terminalData.attachedToContextNodeId
    const callerContextNode: GraphNode | undefined = graph.nodes[callerContextNodeId]
    if (!callerContextNode?.nodeUIMetadata.containedNodeIds) {
        return []
    }

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
    return [{
        type: 'UpsertNode',
        nodeToUpsert: updatedContextNode,
        previousNode: O.some(callerContextNode),
    }]
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

    const snapshot: CreateGraphSnapshot = await getMcpGraphSnapshot()
    const outputDirectoryResult: Result<string> = resolveConfiguredOutputDirectory(snapshot, outputPath)
    if (!outputDirectoryResult.ok) return errorResponse(outputDirectoryResult.error)
    const outputDirectory: string = outputDirectoryResult.value

    const inputValidation: Result<Set<string>> = validateNodeInputs(nodes)
    if (!inputValidation.ok) return errorResponse(inputValidation.error)

    const graph: Graph = snapshot.graph

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
    const contextDelta: GraphDelta = buildCallerContextDelta(graph, callerRecord, batchResult.allNewNodeIds)
    if (contextDelta.length > 0) {
        await tracing.span('createGraph.context-update', async (span) => {
            span.setAttribute('delta.length', contextDelta.length)
            try {
                await applyMcpGraphDelta(contextDelta)
                span.setAttribute('outcome', 'applied')
            } catch (contextError: unknown) {
                span.setAttribute('outcome', 'failed-non-fatal')
                span.recordException(contextError instanceof Error ? contextError : String(contextError))
                span.addEvent('createGraph.context-update.failed', {
                    'error.message': contextError instanceof Error ? contextError.message : String(contextError),
                    'error.type': contextError instanceof Error ? contextError.name : typeof contextError,
                })
                // Non-fatal: context node update failed, nodes were still created.
            }
        })
    }

    resetTerminalAuditRetryCount(callerTerminalId)

    return buildJsonResponse({
        success: true,
        nodes: batchResult.results,
        hint: 'To update a node, edit the file directly at its path. Do not call create_graph again for updates.',
    })
}
