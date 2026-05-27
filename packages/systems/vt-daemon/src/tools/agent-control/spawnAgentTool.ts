/**
 * MCP Tool: spawn_agent
 * Spawns an agent in the Voicetree graph.
 */

import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {findBestMatchingNode} from '@vt/graph-model/markdown'
import {createTaskNode} from '@vt/graph-model/graph'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {type McpToolResponse, buildJsonResponse} from '../toolResponse'
import {startMonitor} from '../agentDependencies'
import {applyMcpGraphDelta, getMcpGraph, getMcpWriteFolder} from '../../config/graphBridge.ts'
import type {GraphBridge} from '../../config/mcpBridges.ts'
import {getAppSupportPath} from '@vt/vt-daemon/state/app-support.ts'
import {
    consumeSpawnBudget,
    listTerminalRecords,
    rememberChildTerminal,
    spawnContextTerminal,
    type TerminalRecord,
} from './agentControlRuntime'

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
    readonly loadWriteFolder: () => Promise<O.Option<string>>
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
        loadAgentSettings: () => loadSettings(getAppSupportPath()),
        loadWriteFolder: () => getMcpWriteFolder(bridge),
        loadGraph: () => getMcpGraph(bridge),
        applyDelta: (delta, recordForUndo) => applyMcpGraphDelta(bridge, delta, recordForUndo),
        spawnTerminal: spawnContextTerminal,
        rememberChild: rememberChildTerminal,
        monitorChildren: (callerTerminalId, terminalIds, pollIntervalMs) =>
            startMonitor(callerTerminalId, terminalIds, bridge, pollIntervalMs),
    }
}

type AgentSetting = { readonly name: string; readonly command: string }

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

type BudgetResult = { readonly allowed: boolean; readonly childBudget: number | undefined }

type SpawnRuntime = {
    readonly callerTerminalId: string
    readonly callerRecord: TerminalRecord
    readonly resolvedAgentCommand: string | undefined
    readonly resolvedSpawnDirectory: string | undefined
    readonly envOverrides: Record<string, string>
    readonly childDepthBudget: number | undefined
}

type GraphContext = {
    readonly graph: Graph
    readonly writeFolder: string
}

type SpawnedTerminal = {
    readonly terminalId: string
    readonly contextNodeId: string
}

function errorResponse(error: string): McpToolResponse {
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

function resolveChildDepthBudget(depthBudget: number | undefined, callerRecord: TerminalRecord): number | undefined {
    if (depthBudget !== undefined) return depthBudget

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

function resolveNamedAgentCommand(agentName: string, agents: readonly AgentSetting[]): Result<string> {
    const matchedAgent: AgentSetting | undefined = agents.find((agent: AgentSetting) => agent.name === agentName)
    if (matchedAgent) return {ok: true, value: matchedAgent.command}

    return {
        ok: false,
        error: `Agent "${agentName}" not found in settings.agents. Available: ${agents.map((agent: AgentSetting) => agent.name).join(', ')}`
    }
}

async function resolveAgentCommand(
    agentName: string | undefined,
    callerRecord: TerminalRecord,
    deps: SpawnAgentDeps,
): Promise<Result<string | undefined>> {
    const callerAgentTypeName: string | undefined = callerRecord.terminalData.agentTypeName
    if (!agentName && !callerAgentTypeName) return {ok: true, value: undefined}

    const settings: VTSettings = await deps.loadAgentSettings()
    const agents: readonly AgentSetting[] = settings?.agents ?? []
    if (agentName) return resolveNamedAgentCommand(agentName, agents)

    const inheritedAgent: AgentSetting | undefined = agents.find(
        (agent: AgentSetting) => agent.name === callerAgentTypeName
    )
    return {ok: true, value: inheritedAgent?.command}
}

function resolveSpawnDirectory(spawnDirectory: string | undefined, callerRecord: TerminalRecord): string | undefined {
    return spawnDirectory ?? callerRecord.terminalData.initialSpawnDirectory
}

async function prepareSpawnRuntime(
    params: SpawnAgentParams,
    deps: SpawnAgentDeps,
    callerRecord: TerminalRecord,
): Promise<Result<SpawnRuntime>> {
    const childDepthBudget: number | undefined = resolveChildDepthBudget(params.depthBudget, callerRecord)
    const budgetResult: BudgetResult = deps.consumeBudget(params.callerTerminalId)
    if (!budgetResult.allowed) return {ok: false, error: 'Global spawn budget exhausted'}

    const agentCommandResult: Result<string | undefined> = await resolveAgentCommand(params.agentName, callerRecord, deps)
    if (!agentCommandResult.ok) return agentCommandResult

    return {
        ok: true,
        value: {
            callerTerminalId: params.callerTerminalId,
            callerRecord,
            resolvedAgentCommand: agentCommandResult.value,
            resolvedSpawnDirectory: resolveSpawnDirectory(params.spawnDirectory, callerRecord),
            envOverrides: buildEnvOverrides(childDepthBudget, budgetResult.childBudget),
            childDepthBudget,
        }
    }
}

async function loadWriteFolder(deps: SpawnAgentDeps): Promise<Result<string>> {
    const vaultPathOpt: O.Option<string> = await deps.loadWriteFolder()
    if (O.isNone(vaultPathOpt)) {
        return {ok: false, error: 'No vault loaded. Please load a folder in the UI first.'}
    }
    return {ok: true, value: vaultPathOpt.value}
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
    callerRecord: TerminalRecord,
    taskNodeId: NodeIdAndFilePath,
): GraphDelta {
    const callerContextNodeId: string | undefined = callerRecord.terminalData.attachedToContextNodeId
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
        ? (runtime.callerRecord.terminalData.parentTerminalId ?? undefined)
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
    if (params.replaceSelf) return

    deps.rememberChild(runtime.callerTerminalId, terminalId)
    deps.monitorChildren(runtime.callerTerminalId, [terminalId], 5000)
}

async function spawnAgentForTask(
    params: SpawnAgentParams,
    taskDescription: string,
    deps: SpawnAgentDeps,
    runtime: SpawnRuntime,
    graphContext: GraphContext,
): Promise<McpToolResponse> {
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
            writeFolder: graphContext.writeFolder,
            initialStatus: 'claimed'
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
                : `Created task node and spawned agent for "${taskDescription}". You will be notified when the agent completes.`
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
): Promise<McpToolResponse> {
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
                : `Spawned agent for node ${resolvedNodeId}. You will be notified when the agent completes.`
        })
    } catch (error) {
        return errorResponse(errorMessage(error))
    }
}

export async function spawnAgentTool(
    params: SpawnAgentParams,
    deps: SpawnAgentDeps,
): Promise<McpToolResponse> {
    const terminalRecords: TerminalRecord[] = deps.listTerminalRecords()
    const callerRecordResult: Result<TerminalRecord> = findCallerRecord(params.callerTerminalId, terminalRecords)
    if (!callerRecordResult.ok) return errorResponse(callerRecordResult.error)

    const runtimeResult: Result<SpawnRuntime> = await prepareSpawnRuntime(params, deps, callerRecordResult.value)
    if (!runtimeResult.ok) return errorResponse(runtimeResult.error)

    const writeFolderResult: Result<string> = await loadWriteFolder(deps)
    if (!writeFolderResult.ok) return errorResponse(writeFolderResult.error)

    const graphContext: GraphContext = {
        graph: await deps.loadGraph(),
        writeFolder: writeFolderResult.value,
    }

    if (params.task) return spawnAgentForTask(params, params.task, deps, runtimeResult.value, graphContext)
    return spawnAgentForExistingNode(params, deps, runtimeResult.value, graphContext)
}
