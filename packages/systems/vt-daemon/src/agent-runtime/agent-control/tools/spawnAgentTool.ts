/**
 * RPC Tool: spawn_agent
 * Spawns an agent in the Voicetree graph.
 */

import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {findBestMatchingNode} from '@vt/graph-model/markdown'
import {createTaskNode} from '@vt/graph-model/graph'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings, AgentConfig, ResolvedAgent} from '@vt/graph-model/settings'
import {flattenAgentTree} from '@vt/graph-model/settings'
import {type ToolResponse, buildJsonResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import {taskFolderNodesEnabledFromEnv} from '@vt/vt-daemon/_shared/taskFolderFeatureFlag.ts'
import {startMonitor} from '../agent-completion-monitor.ts'
import {applyToolGraphDelta, getToolGraph, getToolWriteFolderPath} from '@vt/vt-daemon/config/graphBridge.ts'
import type {GraphBridge} from '@vt/vt-daemon/config/toolBridges.ts'
import {
    consumeSpawnBudget,
    listTerminalRecords,
    rememberChildTerminal,
    spawnContextTerminal,
    type TerminalRecord,
} from '../agentControlRuntime'

export interface SpawnAgentParams {
    nodeId?: string
    callerTerminalId: string
    task?: string
    parentNodeId?: string
    spawnDirectory?: string
    promptTemplate?: string
    agentName?: string
    headless?: boolean
    replaceSelf?: boolean
    depthBudget?: number
}

export interface SpawnAgentDeps {
    readonly listTerminalRecords: () => TerminalRecord[]
    readonly consumeBudget: typeof consumeSpawnBudget
    readonly loadAgentSettings: () => Promise<VTSettings>
    readonly loadWriteFolderPath: () => Promise<O.Option<string>>
    readonly loadGraph: () => Promise<Graph>
    readonly applyDelta: (delta: GraphDelta, recordForUndo?: boolean) => Promise<void>
    readonly spawnTerminal: typeof spawnContextTerminal
    readonly rememberChild: typeof rememberChildTerminal
    readonly monitorChildren: (callerTerminalId: string, terminalIds: string[], pollIntervalMs?: number) => string
}

export function makeSpawnAgentDeps(bridge: GraphBridge): SpawnAgentDeps {
    return {
        listTerminalRecords,
        consumeBudget: consumeSpawnBudget,
        loadAgentSettings: () => loadSettings(),
        loadWriteFolderPath: () => getToolWriteFolderPath(bridge),
        loadGraph: () => getToolGraph(bridge),
        applyDelta: (delta, recordForUndo) => applyToolGraphDelta(bridge, delta, recordForUndo),
        spawnTerminal: spawnContextTerminal,
        rememberChild: rememberChildTerminal,
        monitorChildren: (callerTerminalId, terminalIds, pollIntervalMs) =>
            startMonitor(callerTerminalId, terminalIds, bridge, pollIntervalMs),
    }
}

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

type BudgetResult = { readonly allowed: boolean; readonly childBudget: number | undefined }

type SpawnRuntime = {
    readonly callerTerminalId: string
    readonly callerRecord?: TerminalRecord
    readonly isExternalCaller: boolean
    readonly resolvedAgentCommand: string | undefined
    readonly resolvedSpawnDirectory: string | undefined
    readonly envOverrides: Record<string, string>
    readonly childDepthBudget: number | undefined
}

type GraphContext = {
    readonly graph: Graph
    readonly writeFolderPath: string
}

type SpawnedTerminal = {
    readonly terminalId: string
    readonly contextNodeId: string
}

function errorResponse(error: string): ToolResponse {
    return buildJsonResponse({success: false, error}, true)
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function findCallerRecord(callerTerminalId: string, terminalRecords: readonly TerminalRecord[]): Result<TerminalRecord> {
    const callerRecord: TerminalRecord | undefined = terminalRecords.find(
        (record: TerminalRecord) => record.terminalId === callerTerminalId
    )
    if (!callerRecord) return {ok: false, error: `Unknown caller terminal: ${callerTerminalId}`}
    return {ok: true, value: callerRecord}
}

function isScopedExternalCaller(callerTerminalId: string): boolean {
    const slashIndex: number = callerTerminalId.indexOf('/')
    return slashIndex > 0 && slashIndex < callerTerminalId.length - 1
}

function resolveChildDepthBudget(depthBudget: number | undefined, callerRecord: TerminalRecord | undefined): number | undefined {
    if (depthBudget !== undefined) return depthBudget
    if (!callerRecord) return undefined

    const parentDepthBudget: string | undefined = callerRecord.terminalData.initialEnvVars?.DEPTH_BUDGET
    if (!parentDepthBudget) return undefined

    const parsedParentBudget: number = parseInt(parentDepthBudget, 10)
    if (isNaN(parsedParentBudget)) return undefined

    return Math.max(0, parsedParentBudget - 1)
}

function buildEnvOverrides(childDepthBudget: number | undefined, childGlobalBudget: number | undefined): Record<string, string> {
    return {
        ...(childDepthBudget !== undefined ? {DEPTH_BUDGET: String(childDepthBudget)} : {}),
        ...(childGlobalBudget !== undefined ? {GLOBAL_SPAWN_BUDGET: String(childGlobalBudget)} : {}),
    }
}

/** Find a spawnable leaf by its full path label ('Codex / Remote / XHigh') or, failing that, its leaf name. */
function findAgentLeaf(agents: readonly AgentConfig[], name: string): ResolvedAgent | undefined {
    const leaves: ResolvedAgent[] = flattenAgentTree(agents)
    return leaves.find(leaf => leaf.label === name) ?? leaves.find(leaf => leaf.name === name)
}

function resolveNamedAgent(agentName: string, agents: readonly AgentConfig[]): Result<ResolvedAgent> {
    const matched: ResolvedAgent | undefined = findAgentLeaf(agents, agentName)
    if (matched) return {ok: true, value: matched}

    const available: string = flattenAgentTree(agents).map(leaf => leaf.label).join(', ')
    return {ok: false, error: `Agent "${agentName}" not found in settings.agents. Available: ${available}`}
}

/** Resolve the leaf to spawn — explicit `agentName`, else inherit the caller's agent type, else none. */
async function resolveAgentSelection(
    agentName: string | undefined,
    callerRecord: TerminalRecord | undefined,
    deps: SpawnAgentDeps,
): Promise<Result<ResolvedAgent | undefined>> {
    const callerAgentTypeName: string | undefined = callerRecord?.terminalData.agentTypeName
    if (!agentName && !callerAgentTypeName) return {ok: true, value: undefined}

    const settings: VTSettings = await deps.loadAgentSettings()
    const agents: readonly AgentConfig[] = settings?.agents ?? []
    if (agentName) return resolveNamedAgent(agentName, agents)

    return {ok: true, value: callerAgentTypeName ? findAgentLeaf(agents, callerAgentTypeName) : undefined}
}

async function prepareSpawnRuntime(
    params: SpawnAgentParams,
    deps: SpawnAgentDeps,
    callerRecord: TerminalRecord | undefined,
): Promise<Result<SpawnRuntime>> {
    if (!callerRecord && params.replaceSelf) {
        return {ok: false, error: 'Cannot replace self from a scoped external caller'}
    }

    const childDepthBudget: number | undefined = resolveChildDepthBudget(params.depthBudget, callerRecord)
    const budgetResult: BudgetResult = deps.consumeBudget(params.callerTerminalId)
    if (!budgetResult.allowed) return {ok: false, error: 'Global spawn budget exhausted'}

    const selectionResult: Result<ResolvedAgent | undefined> = await resolveAgentSelection(params.agentName, callerRecord, deps)
    if (!selectionResult.ok) return selectionResult
    const selection: ResolvedAgent | undefined = selectionResult.value

    return {
        ok: true,
        value: {
            callerTerminalId: params.callerTerminalId,
            callerRecord,
            isExternalCaller: !callerRecord,
            resolvedAgentCommand: selection?.command,
            resolvedSpawnDirectory: params.spawnDirectory ?? callerRecord?.terminalData.initialSpawnDirectory,
            // The leaf's env (e.g. { EFFORT }) plus the budget env. Budget vars are
            // spread last so user env can never clobber DEPTH_BUDGET / spawn budget.
            envOverrides: {...selection?.env, ...buildEnvOverrides(childDepthBudget, budgetResult.childBudget)},
            childDepthBudget,
        }
    }
}

async function loadWriteFolderPath(deps: SpawnAgentDeps): Promise<Result<string>> {
    const projectPathOpt: O.Option<string> = await deps.loadWriteFolderPath()
    if (O.isNone(projectPathOpt)) {
        return {ok: false, error: 'No project loaded. Please load a folder in the UI first.'}
    }
    return {ok: true, value: projectPathOpt.value}
}

function resolveNodeId(graph: Graph, nodeId: string): NodeIdAndFilePath | undefined {
    return graph.nodes[nodeId]
        ? nodeId
        : findBestMatchingNode(nodeId, graph.nodes, graph.nodeByBaseName)
}

function taskNodeIdFromDelta(taskNodeDelta: GraphDelta): NodeIdAndFilePath | undefined {
    const firstDelta = taskNodeDelta[0]
    return firstDelta.type === 'UpsertNode'
        ? firstDelta.nodeToUpsert.absoluteFilePathIsID
        : '' as NodeIdAndFilePath
}

function buildCallerContextUpdateDelta(
    graph: Graph,
    callerRecord: TerminalRecord | undefined,
    taskNodeId: NodeIdAndFilePath,
): GraphDelta {
    const callerContextNodeId: string | undefined = callerRecord?.terminalData.attachedToContextNodeId
    if (!callerContextNodeId) return []

    const callerContextNode: GraphNode | undefined = graph.nodes[callerContextNodeId]
    if (!callerContextNode?.nodeUIMetadata.containedNodeIds) return []

    return [{
        type: 'UpsertNode',
        nodeToUpsert: {
            ...callerContextNode,
            nodeUIMetadata: {
                ...callerContextNode.nodeUIMetadata,
                containedNodeIds: [...callerContextNode.nodeUIMetadata.containedNodeIds, taskNodeId]
            }
        },
        previousNode: O.some(callerContextNode)
    }]
}

function claimNodeDelta(targetNode: GraphNode): GraphDelta {
    const claimedYAML: Record<string, string> = {
        ...targetNode.nodeUIMetadata.additionalYAMLProps,
        status: 'claimed'
    }
    return [{
        type: 'UpsertNode',
        nodeToUpsert: {
            ...targetNode,
            nodeUIMetadata: {
                ...targetNode.nodeUIMetadata,
                additionalYAMLProps: claimedYAML
            }
        },
        previousNode: O.some(targetNode)
    }]
}

function parentTerminalIdForSpawn(runtime: SpawnRuntime, replaceSelf: boolean | undefined): string | undefined {
    return replaceSelf
        ? (runtime.callerRecord?.terminalData.parentTerminalId ?? undefined)
        : runtime.callerTerminalId
}

async function spawnTerminalForNode(
    nodeId: NodeIdAndFilePath,
    params: SpawnAgentParams,
    runtime: SpawnRuntime,
    deps: SpawnAgentDeps,
): Promise<SpawnedTerminal> {
    return deps.spawnTerminal(
        nodeId,
        runtime.resolvedAgentCommand,
        undefined,
        true,
        false,
        undefined,
        runtime.resolvedSpawnDirectory,
        parentTerminalIdForSpawn(runtime, params.replaceSelf),
        params.promptTemplate,
        params.headless,
        params.replaceSelf ? runtime.callerTerminalId : undefined,
        runtime.envOverrides,
    )
}

function rememberAndMonitorChild(terminalId: string, params: SpawnAgentParams, runtime: SpawnRuntime, deps: SpawnAgentDeps): void {
    if (params.replaceSelf || runtime.isExternalCaller) return

    deps.rememberChild(runtime.callerTerminalId, terminalId)
    deps.monitorChildren(runtime.callerTerminalId, [terminalId], 5000)
}

function spawnSuccessMessage(baseMessage: string, runtime: SpawnRuntime): string {
    return runtime.isExternalCaller
        ? `${baseMessage} No local completion monitor was started for external caller ${runtime.callerTerminalId}.`
        : `${baseMessage} You will be notified when the agent completes.`
}

async function spawnAgentForTask(
    params: SpawnAgentParams,
    taskDescription: string,
    deps: SpawnAgentDeps,
    runtime: SpawnRuntime,
    graphContext: GraphContext,
): Promise<ToolResponse> {
    if (!params.parentNodeId) return errorResponse('parentNodeId is required when task is provided')

    const resolvedParentId: NodeIdAndFilePath | undefined = resolveNodeId(graphContext.graph, params.parentNodeId)
    if (!resolvedParentId || !graphContext.graph.nodes[resolvedParentId]) {
        return errorResponse(`Parent node ${params.parentNodeId} not found.`)
    }

    try {
        const taskNodeDelta: GraphDelta = createTaskNode({
            taskDescription,
            selectedNodeIds: [resolvedParentId],
            graph: graphContext.graph,
            writeFolderPath: graphContext.writeFolderPath,
            initialStatus: 'claimed',
            useTaskFolderNode: taskFolderNodesEnabledFromEnv(),
        })
        const taskNodeId: NodeIdAndFilePath | undefined = taskNodeIdFromDelta(taskNodeDelta)
        if (!taskNodeId) return errorResponse('Failed to create task node')

        const callerContextUpdateDelta: GraphDelta = buildCallerContextUpdateDelta(
            graphContext.graph,
            runtime.callerRecord,
            taskNodeId,
        )
        await deps.applyDelta([...taskNodeDelta, ...callerContextUpdateDelta])

        const {terminalId, contextNodeId}: SpawnedTerminal = await spawnTerminalForNode(taskNodeId, params, runtime, deps)
        rememberAndMonitorChild(terminalId, params, runtime, deps)

        return buildJsonResponse({
            success: true,
            terminalId,
            taskNodeId,
            contextNodeId,
            depthBudget: runtime.childDepthBudget,
            message: params.replaceSelf
                ? `Replaced self — successor agent running as "${terminalId}"`
                : spawnSuccessMessage(`Created task node and spawned agent for "${taskDescription}".`, runtime)
        })
    } catch (error) {
        return errorResponse(errorMessage(error))
    }
}

async function spawnAgentForExistingNode(
    params: SpawnAgentParams,
    deps: SpawnAgentDeps,
    runtime: SpawnRuntime,
    graphContext: GraphContext,
): Promise<ToolResponse> {
    if (!params.nodeId) return errorResponse('Either nodeId or task (with parentNodeId) must be provided')

    const resolvedNodeId: NodeIdAndFilePath | undefined = resolveNodeId(graphContext.graph, params.nodeId)
    const targetNode: GraphNode | undefined = resolvedNodeId ? graphContext.graph.nodes[resolvedNodeId] : undefined
    if (!resolvedNodeId || !targetNode) return errorResponse(`Node ${params.nodeId} not found.`)

    try {
        await deps.applyDelta(claimNodeDelta(targetNode))

        const {terminalId, contextNodeId}: SpawnedTerminal = await spawnTerminalForNode(resolvedNodeId, params, runtime, deps)
        rememberAndMonitorChild(terminalId, params, runtime, deps)

        return buildJsonResponse({
            success: true,
            terminalId,
            nodeId: resolvedNodeId,
            contextNodeId,
            depthBudget: runtime.childDepthBudget,
            message: params.replaceSelf
                ? `Replaced self — successor agent running as "${terminalId}"`
                : spawnSuccessMessage(`Spawned agent for node ${resolvedNodeId}.`, runtime)
        })
    } catch (error) {
        return errorResponse(errorMessage(error))
    }
}

export async function spawnAgentTool(
    params: SpawnAgentParams,
    deps: SpawnAgentDeps,
): Promise<ToolResponse> {
    const terminalRecords: TerminalRecord[] = deps.listTerminalRecords()
    const callerRecordResult: Result<TerminalRecord> = findCallerRecord(params.callerTerminalId, terminalRecords)
    if (!callerRecordResult.ok && !isScopedExternalCaller(params.callerTerminalId)) {
        return errorResponse(callerRecordResult.error)
    }

    const runtimeResult: Result<SpawnRuntime> = await prepareSpawnRuntime(
        params,
        deps,
        callerRecordResult.ok ? callerRecordResult.value : undefined,
    )
    if (!runtimeResult.ok) return errorResponse(runtimeResult.error)

    const writeFolderPathResult: Result<string> = await loadWriteFolderPath(deps)
    if (!writeFolderPathResult.ok) return errorResponse(writeFolderPathResult.error)

    const graphContext: GraphContext = {
        graph: await deps.loadGraph(),
        writeFolderPath: writeFolderPathResult.value,
    }

    if (params.task) return spawnAgentForTask(params, params.task, deps, runtimeResult.value, graphContext)
    return spawnAgentForExistingNode(params, deps, runtimeResult.value, graphContext)
}
