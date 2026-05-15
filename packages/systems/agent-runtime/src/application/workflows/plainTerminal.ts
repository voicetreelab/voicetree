import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position} from '@vt/graph-model/graph'
import {createNewNodeNoParent} from '@vt/graph-model/graph'
import {getNodeTitle} from '@vt/graph-model/markdown'
import {getNextAgentName, getUniqueAgentName, type VTSettings} from '@vt/graph-model/settings'
import * as O from 'fp-ts/lib/Option.js'
import {loadSettings} from '@vt/app-config/settings'
import {buildTerminalEnvVars} from '@vt/agent-runtime/spawn/buildTerminalEnvVars.ts'
import {getExistingAgentNames} from '@vt/agent-runtime/terminals/terminal-registry/index.ts'
import {
    getRuntimeGraph,
    getRuntimeWatchStatus,
    getRuntimeWritePath,
} from '@vt/agent-runtime/runtime/graph-bridge'
import {handlePlainTerminal} from '../core/handlePlainTerminal.ts'
import {runCommand} from '../effects/runCommand.ts'

export async function spawnPlainTerminalWorkflow(
    nodeId: NodeIdAndFilePath,
    terminalCount: number,
): Promise<void> {
    const settings: VTSettings = await loadSettings()
    const graph: Graph = await getRuntimeGraph()
    const node: GraphNode | undefined = graph.nodes[nodeId]
    const title: string = node ? getNodeTitle(node) : 'Terminal'
    const watchStatus: { readonly isWatching: boolean; readonly directory: string | undefined } = getRuntimeWatchStatus()
    const baseAgentName: string = getNextAgentName()
    const existingAgentNames: Set<string> = getExistingAgentNames()
    const agentName: string = getUniqueAgentName(baseAgentName, existingAgentNames)
    const expandedEnvVars: Record<string, string> = await buildTerminalEnvVars({
        contextNodePath: nodeId,
        taskNodePath: nodeId,
        terminalId: agentName,
        agentName,
        settings,
    })
    const result = handlePlainTerminal({
        nodeId,
        terminalCount,
        title,
        settings,
        watchDirectory: watchStatus.directory,
        agentName,
        expandedEnvVars,
    })

    for (const command of result.commands) {
        await runCommand(command)
    }
}

export async function spawnPlainTerminalWithNodeWorkflow(
    position: Position,
    terminalCount: number,
): Promise<void> {
    const writePathOption: O.Option<string> = await getRuntimeWritePath()
    const writePath: string = O.getOrElse(() => '')(writePathOption)
    const graph: Graph = await getRuntimeGraph()
    const {newNode, graphDelta}: {readonly newNode: GraphNode; readonly graphDelta: GraphDelta} =
        createNewNodeNoParent(position, writePath, graph)

    await runCommand({
        type: 'ApplyRuntimeGraphDelta',
        graphDelta,
    })
    await spawnPlainTerminalWorkflow(newNode.absoluteFilePathIsID, terminalCount)
}
