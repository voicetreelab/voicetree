// Overnight trigger: spawns a meta-observer agent for an overnight batch run.
// Bypasses MCP protocol — invoked over plain HTTP at /trigger-overnight.

import {readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, NodeIdAndFilePath, Position} from '@vt/graph-model/graph'
import {createTaskNode} from '@vt/graph-model/graph'
import {calculateNodePosition} from '@vt/graph-model/spatial'
import {buildSpatialIndexFromGraph} from '@vt/graph-model/spatial'
import type {SpatialIndex} from '@vt/graph-model/spatial'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {applyMcpGraphDelta, getMcpGraphSnapshot} from '../mcpConfigDependencies'
import {spawnContextTerminal} from '../agent-control/agentControlRuntime'

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

const OVERNIGHT_PROMPT_PATH: string = join(
    homedir(),
    'brain/workflows/meta-cognitive-protocols-tools-patterns/coaching/meta-observer/overnight-trigger.md',
)

// Fallback template, used if OVERNIGHT_PROMPT_PATH is missing. Kept in sync
// with that file so the system stays functional even if the user's brain
// vault is unavailable or the file has been moved.
const FALLBACK_PROMPT_TEMPLATE: string = [
    'Read and follow [~/brain/workflows/meta-cognitive-protocols-tools-patterns/coaching/meta-observer/SKILL.md]',
    '',
    'Parameters:',
    'MAX_TASKS={{MAX_TASKS}}',
    'COMPLEXITY_THRESHOLD={{COMPLEXITY_THRESHOLD}}',
    'COST_CAP_USD={{COST_CAP_USD}}',
    'DRY_RUN={{DRY_RUN}}',
    '',
    'After completing the BF task batch (or if no tasks qualify), run self-repair:',
    '1. Spawn a gardening agent: read and follow [~/brain/workflows/system/system-health/gardening/SKILL.md] with TARGET_PATH=~/brain/knowledge/ MODE=assess DEPTH_BUDGET=10',
    '2. Read [~/brain/mem/schedule.md] for tree-sleep vault entries. Spawn tree-sleep agents (MODE=assess) only for vaults listed there. Skip any vault with fewer than 30 nodes.',
    'Include self-repair results in your meta-report.',
].join('\n')

async function loadOvernightPromptTemplate(): Promise<string> {
    try {
        return await readFile(OVERNIGHT_PROMPT_PATH, 'utf8')
    } catch {
        return FALLBACK_PROMPT_TEMPLATE
    }
}

function renderOvernightPrompt(
    template: string,
    params: {maxTasks: number; complexityThreshold: number; costCapUsd: number; dryRun: boolean},
): string {
    return template
        .replace(/\{\{MAX_TASKS\}\}/g, String(params.maxTasks))
        .replace(/\{\{COMPLEXITY_THRESHOLD\}\}/g, String(params.complexityThreshold))
        .replace(/\{\{COST_CAP_USD\}\}/g, String(params.costCapUsd))
        .replace(/\{\{DRY_RUN\}\}/g, String(params.dryRun))
}

/**
 * Spawns a meta-observer agent for an overnight batch run.
 * Creates a task node, resolves the Opus agent, and launches with
 * the meta-observer SKILL.md prompt and user-provided parameters.
 */
export async function triggerOvernight(
    params: TriggerOvernightParams,
    deps: TriggerOvernightDeps = defaultTriggerOvernightDeps,
): Promise<TriggerOvernightResult> {
    const snapshot = await getMcpGraphSnapshot()
    if (!snapshot.writeFolder) {
        return {success: false, error: 'No vault loaded. Open a folder in VoiceTree first.'}
    }
    const writeFolder: string = snapshot.writeFolder

    const graph: Graph = snapshot.graph
    const nodeIds: readonly string[] = Object.keys(graph.nodes)
    if (nodeIds.length === 0) {
        return {success: false, error: 'Graph is empty — no nodes to anchor overnight run.'}
    }

    // Anchor the overnight run task node to the first graph node
    const parentNodeId: NodeIdAndFilePath = nodeIds[0] as NodeIdAndFilePath

    const spatialIndex: SpatialIndex = buildSpatialIndexFromGraph(graph)
    const position: Position = O.getOrElse(() => ({x: 0, y: 0}))(
        calculateNodePosition(graph, spatialIndex, parentNodeId)
    )

    const isoDate: string = deps.getIsoDate()
    const taskDescription: string = `Overnight Run — ${isoDate}`

    const taskNodeDelta: GraphDelta = createTaskNode({
        taskDescription,
        selectedNodeIds: [parentNodeId],
        graph,
        writeFolder,
        position
    })

    const taskNodeId: NodeIdAndFilePath = taskNodeDelta[0].type === 'UpsertNode'
        ? taskNodeDelta[0].nodeToUpsert.absoluteFilePathIsID
        : '' as NodeIdAndFilePath

    if (!taskNodeId) {
        return {success: false, error: 'Failed to create task node'}
    }

    await applyMcpGraphDelta(taskNodeDelta)

    // Resolve Opus agent command (find "Claude" in settings.agents)
    const settings: VTSettings = await loadSettings()
    const agents: readonly {readonly name: string; readonly command: string}[] = settings?.agents ?? []
    const claudeAgent: {readonly name: string; readonly command: string} | undefined =
        agents.find((a: {readonly name: string; readonly command: string}) => a.name === 'Claude')
    const agentCommand: string | undefined = claudeAgent?.command

    const agentPrompt: string = renderOvernightPrompt(await loadOvernightPromptTemplate(), {
        maxTasks: params.maxTasks ?? 3,
        complexityThreshold: params.complexityThreshold ?? 4,
        costCapUsd: params.costCapUsd ?? 5,
        dryRun: params.dryRun ?? false,
    })

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
