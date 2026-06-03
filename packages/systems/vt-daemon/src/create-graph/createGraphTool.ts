/**
 * RPC Tool: create_graph
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
import {getFolderIdentityNoteId} from '@vt/graph-model/graph'
import {findBestMatchingNode} from '@vt/graph-model/markdown'
import {slugify} from '../tools/graph/addProgressNodeTool'
import {type ToolResponse, buildJsonResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {
    DEFAULT_SUBGRAPH_WARN_THRESHOLD,
    DEFAULT_SUBGRAPH_ERROR_THRESHOLD,
    DEFAULT_MAX_CHILDREN_PER_NODE,
    DEFAULT_COMPLEXITY_WARN_SCORE,
    DEFAULT_COMPLEXITY_BLOCK_SCORE,
} from '@vt/graph-model/settings'
import {
    type ValidationResult,
    type RuleViolation,
    ALL_RULES,
    runValidations,
    resolveOverrides,
    formatViolationError,
    partitionViolationsBySeverity,
} from './createGraphValidation'
import type {OverrideEntry} from '@vt/graph-validation'
import {registerAgentNodes} from '../agent-runtime/agent-control/completion/agentNodeIndex.ts'
import {applyToolGraphDelta, getToolGraph, getToolProjectPaths, getToolWriteFolderPath} from '../config/graphBridge.ts'
import type {GraphBridge} from '../config/toolBridges.ts'
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
import {applyAgentStatus, listTerminalRecords, resetTerminalAuditRetryCount, type TerminalRecord} from './createGraphRuntime'
import type {AgentStatus} from '@vt/vt-daemon-protocol'

export type {CreateGraphNodeInput}

export interface CreateGraphParams {
    readonly callerTerminalId: string
    readonly parentNodeId?: string
    readonly outputPath?: string
    readonly nodes: readonly CreateGraphNodeInput[]
    readonly override_with_rationale?: readonly OverrideEntry[]
    /**
     * Agent-authored status preset reported alongside this progress node. Drives
     * the caller terminal's lifecycle icon in the sidebar (working→active,
     * awaiting_input, done→completed, failed→errored).
     */
    readonly agentStatus?: AgentStatus
    /**
     * Free-text live status phrase (≤ MAX_STATUS_PHRASE_LENGTH chars) shown next
     * to the model name in the terminal tree.
     */
    readonly statusPhrase?: string
}

function errorResponse(error: string): ToolResponse {
    return buildJsonResponse({success: false, error}, true)
}

interface ResponseWarning {
    readonly ruleId: string
    readonly message: string
    readonly details: Record<string, unknown>
}

/** Shape non-blocking validation warnings for the create_graph success response. */
function formatWarnings(warnings: readonly RuleViolation[]): readonly ResponseWarning[] {
    return warnings.map((w: RuleViolation): ResponseWarning => ({
        ruleId: w.ruleId,
        message: w.message,
        details: w.details,
    }))
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

export interface WorktreeRouting {
    /** Effective output path to resolve (worktree folder name, or the caller's outputPath). */
    readonly outputPath: string | undefined
    /** True when nodes are being routed into a per-worktree folder. */
    readonly active: boolean
    /** The originating worktree name (for the folder identity note title), else null. */
    readonly worktreeName: string | null
}

/**
 * Route a worktree agent's nodes into a `<writeFolder>/<worktreeName>/` folder.
 * An explicit `outputPath` always wins (deliberate placement is respected); a
 * caller with no `worktreeName` is unaffected. The folder segment is `slugify`d
 * so it matches the folder identity note's slugified filename (the `foo/foo.md`
 * convention) — identical to the raw name for conventional worktree names.
 */
export function resolveWorktreeRouting(outputPath: string | undefined, worktreeName: string | undefined): WorktreeRouting {
    const hasExplicitOutput: boolean = !!outputPath && outputPath.trim() !== ''
    if (hasExplicitOutput || !worktreeName || worktreeName.trim() === '') {
        return {outputPath, active: false, worktreeName: null}
    }
    return {outputPath: slugify(worktreeName), active: true, worktreeName}
}

/**
 * The folder identity note for a worktree folder: a node `<folder>/<folder>.md`
 * (title = worktree name) that makes the folder a real, collapsible folder node
 * and exempts it from the gardening child-count. Returns null when routing is
 * inactive or the folder note already exists (convergence: a second agent in the
 * same worktree must not duplicate it).
 */
export function worktreeFolderNoteInput(
    routing: WorktreeRouting,
    outputDirectory: string,
    graph: Graph,
): CreateGraphNodeInput | null {
    if (!routing.active || routing.worktreeName === null) return null
    const folderNoteId: NodeIdAndFilePath = getFolderIdentityNoteId(`${outputDirectory}/`)
    if (graph.nodes[folderNoteId] !== undefined) return null
    return {
        filename: routing.worktreeName,
        title: routing.worktreeName,
        summary: `Folder for nodes created by agents in the ${routing.worktreeName} worktree.`,
    }
}

async function resolveConfiguredOutputDirectory(outputPath: string | undefined, bridge: GraphBridge): Promise<Result<string>> {
    const projectPathOpt: O.Option<string> = await getToolWriteFolderPath(bridge)
    if (O.isNone(projectPathOpt)) {
        return {ok: false, error: 'No project loaded. Please load a folder in the UI first.'}
    }

    const writeFolderPath: string = projectPathOpt.value
    const loadedProjectPaths: readonly string[] = await getToolProjectPaths(bridge)
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

interface OverridableRuleOutcome {
    /** Blocking error message for unresolved violations, or null if the create may proceed. */
    readonly error: string | null
    /** Non-blocking warnings to surface in the success response. */
    readonly warnings: readonly RuleViolation[]
}

async function validateOverridableRules(
    nodes: readonly CreateGraphNodeInput[],
    callerRecord: TerminalRecord,
    graph: Graph,
    resolvedParentNodeId: NodeIdAndFilePath,
    destinationFolderPath: string,
    overrides: readonly OverrideEntry[] | undefined
): Promise<OverridableRuleOutcome> {
    const callerTaskNodeId: NodeIdAndFilePath | null =
        O.isSome(callerRecord.terminalData.anchoredToNodeId) ? callerRecord.terminalData.anchoredToNodeId.value : null
    const settings: VTSettings = await loadSettings()
    const validationResult: ValidationResult = runValidations(ALL_RULES, {
        nodes,
        resolvedParentNodeId,
        callerTaskNodeId,
        graph,
        lineLimit: settings.nodeLineLimit ?? 70,
        subgraphWarnThreshold: settings.subgraphWarnThreshold ?? DEFAULT_SUBGRAPH_WARN_THRESHOLD,
        subgraphErrorThreshold: settings.subgraphErrorThreshold ?? DEFAULT_SUBGRAPH_ERROR_THRESHOLD,
        maxChildrenPerNode: settings.maxChildrenPerNode ?? DEFAULT_MAX_CHILDREN_PER_NODE,
        complexityWarnScore: settings.complexityWarnScore ?? DEFAULT_COMPLEXITY_WARN_SCORE,
        complexityBlockScore: settings.complexityBlockScore ?? DEFAULT_COMPLEXITY_BLOCK_SCORE,
        destinationFolderPath,
    })
    if (validationResult.status !== 'violations') return {error: null, warnings: []}

    const {warnings, blocking} = partitionViolationsBySeverity(validationResult.violations)
    const {unresolved} = resolveOverrides(blocking, overrides ?? [])
    return {error: unresolved.length > 0 ? formatViolationError(unresolved) : null, warnings}
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
        const updatedGraph: Graph = await getToolGraph(bridge)
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
        await applyToolGraphDelta(bridge, contextDelta)
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
        agentStatus,
        statusPhrase,
    }: CreateGraphParams,
    bridge: GraphBridge,
): Promise<ToolResponse> {
    const callerRecordResult: Result<TerminalRecord> = findCallerRecord(callerTerminalId)
    if (!callerRecordResult.ok) return errorResponse(callerRecordResult.error)
    const callerRecord: TerminalRecord = callerRecordResult.value

    const worktreeRouting: WorktreeRouting = resolveWorktreeRouting(outputPath, callerRecord.terminalData.worktreeName)
    const outputDirectoryResult: Result<string> = await resolveConfiguredOutputDirectory(worktreeRouting.outputPath, bridge)
    if (!outputDirectoryResult.ok) return errorResponse(outputDirectoryResult.error)
    const outputDirectory: string = outputDirectoryResult.value

    const inputValidation: Result<void> = validateNodeInputs(nodes)
    if (!inputValidation.ok) return errorResponse(inputValidation.error)

    const graph: Graph = await getToolGraph(bridge)

    const graphParentResult: Result<GraphParentContext> = resolveGraphParent(graph, callerRecord, graphParentId)
    if (!graphParentResult.ok) return errorResponse(graphParentResult.error)
    const graphParent: GraphParentContext = graphParentResult.value

    const agentName: string = callerRecord.terminalData.agentName
    const defaultColor: string = callerRecord.terminalData.initialEnvVars?.['AGENT_COLOR'] ?? 'blue'

    // The destination folder (graph folder id) is the output directory the batch
    // lands in, with a trailing slash — the component the gardening gate counts.
    const destinationFolderPath: string = `${outputDirectory}/`
    const validation: OverridableRuleOutcome = await validateOverridableRules(
        nodes, callerRecord, graph, graphParent.resolvedGraphParentId, destinationFolderPath, override_with_rationale
    )
    if (validation.error) return errorResponse(validation.error)

    // Worktree routing manufactures the bounded component the gate counts: the
    // folder identity note is created in the same batch (once per worktree folder),
    // making <writeFolder>/<worktree>/ a real folder node before the agent's nodes land.
    const folderNote: CreateGraphNodeInput | null = worktreeFolderNoteInput(worktreeRouting, outputDirectory, graph)
    const sortedNodes: CreateGraphNodeInput[] = topologicalSort(nodes)
    const batchInputNodes: readonly CreateGraphNodeInput[] = folderNote ? [folderNote, ...sortedNodes] : sortedNodes
    const batchResult: BatchBuildResult = await buildNodeBatch(
        batchInputNodes, graph, outputDirectory, graphParent, agentName, defaultColor
    )

    if (batchResult.batchDelta.length > 0) {
        await applyToolGraphDelta(bridge, batchResult.batchDelta)
    }

    registerAgentNodes(callerTerminalId, createdAgentNodeRecords(sortedNodes, batchResult.createdNodes))
    await appendNodesToCallerContext(callerRecord, batchResult.allNewNodeIds, bridge)

    resetTerminalAuditRetryCount(callerTerminalId)

    // Apply the agent-authored status reported with this progress node. This is
    // the sole driver of the caller's lifecycle icon + live status phrase now
    // that the legacy CLI-hook adapter is gone. No-op when neither is provided.
    if (agentStatus !== undefined || statusPhrase !== undefined) {
        applyAgentStatus(callerTerminalId, {preset: agentStatus, phrase: statusPhrase})
    }

    return buildJsonResponse({
        success: true,
        nodes: batchResult.results,
        warnings: formatWarnings(validation.warnings),
        hint: 'To update a node, edit the file directly at its path. Do not call create_graph again for updates.',
    })
}
