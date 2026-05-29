// Overnight trigger: spawns a meta-observer agent for an overnight batch run.
// Bypasses MCP protocol — invoked over plain HTTP at /trigger-overnight.

import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {createTaskNode} from '@vt/graph-model/graph'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {applyMcpGraphDelta, getMcpGraph, getMcpWriteFolderPath} from '@vt/vt-daemon/config/graphBridge.ts'
import type {GraphBridge} from '@vt/vt-daemon/config/mcpBridges.ts'
import {spawnContextTerminal} from '@vt/vt-daemon/agent-runtime/agent-control/agentControlRuntime.ts'

export interface TriggerOvernightParams {
    maxTasks?: number
    complexityThreshold?: number
    costCapUsd?: number
    dryRun?: boolean
}

export interface TriggerOvernightResult {
    success: boolean
    terminalId?: string
    taskNodeId?: string
    error?: string
}

export interface TriggerOvernightDeps {
    readonly getIsoDate: () => string
}

function getCurrentIsoDate(): string {
    return new Date().toISOString().slice(0, 10)
}

const defaultTriggerOvernightDeps: TriggerOvernightDeps = {
    getIsoDate: getCurrentIsoDate,
}

/**
 * Spawns a meta-observer agent for an overnight batch run.
 * Creates a task node, resolves the Opus agent, and launches with
 * the meta-observer SKILL.md prompt and user-provided parameters.
 */
export async function triggerOvernight(
    params: TriggerOvernightParams,
    bridge: GraphBridge,
    deps: TriggerOvernightDeps = defaultTriggerOvernightDeps,
): Promise<TriggerOvernightResult> {
    const vaultPathOpt: O.Option<string> = await getMcpWriteFolderPath(bridge)
    if (O.isNone(vaultPathOpt)) {
        return {success: false, error: 'No vault loaded. Open a folder in VoiceTree first.'}
    }
    const writeFolderPath: string = vaultPathOpt.value

    const graph: Graph = await getMcpGraph(bridge)
    const nodeIds: readonly string[] = Object.keys(graph.nodes)
    if (nodeIds.length === 0) {
        return {success: false, error: 'Graph is empty — no nodes to anchor overnight run.'}
    }

    // Anchor the overnight run task node to the first graph node
    const parentNodeId: NodeIdAndFilePath = nodeIds[0] as NodeIdAndFilePath

    const isoDate: string = deps.getIsoDate()
    const taskDescription: string = `Overnight Run — ${isoDate}`

    const taskNodeDelta: GraphDelta = createTaskNode({
        taskDescription,
        selectedNodeIds: [parentNodeId],
        graph,
        writeFolderPath,
    })

    const taskNodeId: NodeIdAndFilePath = taskNodeDelta[0].type === 'UpsertNode'
        ? taskNodeDelta[0].nodeToUpsert.absoluteFilePathIsID
        : '' as NodeIdAndFilePath

    if (!taskNodeId) {
        return {success: false, error: 'Failed to create task node'}
    }

    await applyMcpGraphDelta(bridge, taskNodeDelta)

    // Resolve Opus agent command (find "Claude" in settings.agents)
    const settings: VTSettings = await loadSettings()
    const agents: readonly {readonly name: string; readonly command: string}[] = settings?.agents ?? []
    const claudeAgent: {readonly name: string; readonly command: string} | undefined =
        agents.find((a: {readonly name: string; readonly command: string}) => a.name === 'Claude')
    const agentCommand: string | undefined = claudeAgent?.command

    // Build meta-observer prompt with parameters
    const maxTasks: number = params.maxTasks ?? 3
    const complexityThreshold: number = params.complexityThreshold ?? 4
    const costCapUsd: number = params.costCapUsd ?? 5
    const dryRun: boolean = params.dryRun ?? false

    const agentPrompt: string = [
        'Read and follow ~/brain/workflows/meta-cognitive-protocols-tools-patterns/coaching/meta-observer/SKILL.md',
        '',
        'Parameters:',
        `MAX_TASKS=${maxTasks}`,
        `COMPLEXITY_THRESHOLD=${complexityThreshold}`,
        `COST_CAP_USD=${costCapUsd}`,
        `DRY_RUN=${dryRun}`,
        '',
        'After completing the BF task batch (or if no tasks qualify), run self-repair:',
        '1. Spawn a gardening agent: read and follow ~/brain/workflows/system/system-health/gardening/SKILL.md with TARGET_PATH=~/brain/knowledge/ MODE=assess DEPTH_BUDGET=10',
        '2. Read ~/brain/working-memory/schedule.md for tree-sleep vault entries. Spawn tree-sleep agents (MODE=assess) only for vaults listed there. Skip any vault with fewer than 30 nodes.',
        'Include self-repair results in your meta-report.',
    ].join('\n')

    // Spawn agent — not headless (meta-observer needs wait_for_agents)
    const {terminalId}: {terminalId: string} = await spawnContextTerminal(
        taskNodeId,
        agentCommand,
        undefined,    // terminalCount
        true,         // skipFitAnimation
        false,        // startUnpinned
        undefined,    // selectedNodeIds
        undefined,    // spawnDirectory
        undefined,    // parentTerminalId
        undefined,    // promptTemplate
        false,        // headless
        undefined,    // inheritTerminalId
        {DEPTH_BUDGET: '3', AGENT_PROMPT: agentPrompt}
    )

    return {success: true, terminalId, taskNodeId}
}
