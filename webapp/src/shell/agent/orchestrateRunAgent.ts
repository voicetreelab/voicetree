/**
 * Edge-agnostic orchestrator for the "Run Agent on Selected Nodes" gesture.
 *
 * The flow is identical in Electron and browser mode — only the effects differ
 * (Electron talks to the daemon over IPC; the browser over VTD JSON-RPC). So the
 * orchestration lives here as a single deep function whose collaborators are
 * injected; each edge supplies its own `RunAgentEffects`.
 *
 * Flow:
 *   1. Build a task node delta from the description + selected nodes (pure).
 *   2. Apply the delta (creates the task node on disk via the daemon).
 *   3. Spawn the agent terminal, which creates the context node internally.
 *
 * Imports are browser-safe (graph-model + fp-ts only) so the browser bundle can
 * pull this in without dragging Electron-main code along.
 */

import type {Graph, GraphDelta, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {createTaskNode} from '@vt/graph-model/graph'
import * as O from 'fp-ts/lib/Option.js'

export interface RunAgentOnSelectedParams {
    readonly selectedNodeIds: readonly NodeIdAndFilePath[]
    readonly taskDescription: string
}

export interface RunAgentOnSelectedResult {
    readonly taskNodeId: NodeIdAndFilePath
    readonly contextNodeId: NodeIdAndFilePath
    readonly terminalId: string
}

export interface SpawnAgentTerminalRequest {
    readonly taskNodeId: NodeIdAndFilePath
    readonly skipFitAnimation: boolean
    readonly startUnpinned: boolean
    readonly selectedNodeIds: readonly NodeIdAndFilePath[]
}

export interface SpawnAgentTerminalResult {
    readonly terminalId: string
    readonly contextNodeId: NodeIdAndFilePath
}

/** The daemon-facing collaborators the orchestration needs, injected per edge. */
export interface RunAgentEffects {
    readonly getGraph: () => Promise<Graph>
    readonly getWriteFolderPath: () => Promise<O.Option<string>>
    readonly applyTaskNodeDelta: (delta: GraphDelta) => Promise<unknown>
    readonly spawnAgentTerminal: (req: SpawnAgentTerminalRequest) => Promise<SpawnAgentTerminalResult>
    readonly isTaskFolderNodeEnabled?: () => boolean
}

export async function orchestrateRunAgentOnSelectedNodes(
    params: RunAgentOnSelectedParams,
    effects: RunAgentEffects,
): Promise<RunAgentOnSelectedResult> {
    const {selectedNodeIds, taskDescription} = params

    if (selectedNodeIds.length === 0) {
        throw new Error('No nodes selected')
    }

    const graph: Graph = await effects.getGraph()
    const writeFolderPath: string = O.getOrElse(() => '')(await effects.getWriteFolderPath())

    // createTaskNode places the node via layout (position: O.none); the click
    // position is intentionally not threaded here.
    const taskNodeDelta: GraphDelta = createTaskNode({
        taskDescription,
        selectedNodeIds,
        graph,
        writeFolderPath,
        useTaskFolderNode: effects.isTaskFolderNodeEnabled?.() === true,
    })

    const head = taskNodeDelta[0]
    const taskNodeId: NodeIdAndFilePath =
        head?.type === 'UpsertNode' ? head.nodeToUpsert.absoluteFilePathIsID : ('' as NodeIdAndFilePath)
    if (!taskNodeId) {
        throw new Error('Failed to create task node')
    }

    await effects.applyTaskNodeDelta(taskNodeDelta)

    // spawnAgentTerminal creates the context node internally and returns its id.
    const {terminalId, contextNodeId} = await effects.spawnAgentTerminal({
        taskNodeId,
        skipFitAnimation: false,
        startUnpinned: false,
        selectedNodeIds,
    })

    return {taskNodeId, contextNodeId, terminalId}
}
