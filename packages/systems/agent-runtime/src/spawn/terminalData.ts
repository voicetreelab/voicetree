import path from 'path'
import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {getNodeTitle} from '@vt/graph-model/markdown'
import type {VTSettings} from '@vt/graph-model/settings'
import {getNextAgentName, getUniqueAgentName} from '@vt/graph-model/settings'
import {createTerminalData, type TerminalData, type TerminalId} from '../terminals/terminal-registry/types'
import {getExistingAgentNames} from '../terminals/terminal-registry'
import {buildTerminalEnvVars} from './buildTerminalEnvVars'
import {getRuntimeGraph, getRuntimeWatchStatus} from '../runtime/graph-bridge'

/**
 * Extract worktree directory name from a spawn path, if it's inside a .worktrees/ directory.
 * Returns undefined if the path is not a worktree path.
 *
 * Example: "/repo/.worktrees/wt-fix-auth-bug-a3k" -> "wt-fix-auth-bug-a3k"
 */
function extractWorktreeNameFromPath(spawnDirectory: string | undefined): string | undefined {
    if (!spawnDirectory) return undefined
    const marker: string = '.worktrees/'
    const markerIndex: number = spawnDirectory.indexOf(marker)
    if (markerIndex === -1) return undefined
    const afterMarker: string = spawnDirectory.slice(markerIndex + marker.length)
    // Take just the first path segment (the worktree directory name)
    const slashIndex: number = afterMarker.indexOf('/')
    const dirName: string = slashIndex === -1 ? afterMarker : afterMarker.slice(0, slashIndex)
    return dirName || undefined
}

function resolveInitialSpawnDirectory(
    watchDirectory: string | undefined,
    terminalRelativePath: string | undefined,
    spawnDirectory: string | undefined,
): string | undefined {
    if (spawnDirectory) return spawnDirectory
    if (watchDirectory && terminalRelativePath) {
        const relativePath: string = terminalRelativePath.replace(/^\.\//, '')
        return path.join(watchDirectory, relativePath)
    }
    return watchDirectory
}

/**
 * Prepare terminal data in main process.
 *
 * Equivalent to the UI-side prepareTerminalData function, but using
 * main process state access (graph-store, settings, watchFolder).
 */
export async function prepareTerminalDataInMain(
    contextNodeId: NodeIdAndFilePath,
    taskNodeId: NodeIdAndFilePath,
    terminalCount: number,
    command: string,
    settings: VTSettings,
    startUnpinned?: boolean,
    spawnDirectory?: string,
    parentTerminalId?: string,
    promptTemplate?: string,
    headless?: boolean,
    inheritTerminalId?: string,
    envOverrides?: Record<string, string>,
    precomputedAgentName?: string
): Promise<TerminalData> {
    const graph: Graph = getRuntimeGraph()
    const contextNode: GraphNode = graph.nodes[contextNodeId]
    if (!contextNode) {
        throw new Error(`Context node ${contextNodeId} not found in graph`)
    }

    // Context nodes are orphaned, so use the taskNodeId directly for the title.
    const taskNode: GraphNode | undefined = graph.nodes[taskNodeId]
    const title: string = taskNode ? getNodeTitle(taskNode) : getNodeTitle(contextNode)

    const agentName: string = precomputedAgentName ?? inheritTerminalId ?? (() => {
        const baseAgentName: string = getNextAgentName()
        const existingNames: Set<string> = getExistingAgentNames()
        return getUniqueAgentName(baseAgentName, existingNames)
    })()

    const watchStatus: {
        readonly isWatching: boolean
        readonly directory: string | undefined
    } = getRuntimeWatchStatus()
    const initialSpawnDirectory: string | undefined = resolveInitialSpawnDirectory(
        watchStatus.directory,
        settings.terminalSpawnPathRelativeToWatchedDirectory,
        spawnDirectory,
    )

    const taskNodeAbsolutePath: string = taskNode ? taskNode.absoluteFilePathIsID : ''
    const terminalId: TerminalId = agentName as TerminalId
    const expandedEnvVars: Record<string, string> = await buildTerminalEnvVars({
        contextNodePath: contextNodeId,
        taskNodePath: taskNodeAbsolutePath,
        terminalId: agentName,
        agentName,
        settings,
        promptTemplate,
        envOverrides,
    })

    const worktreeName: string | undefined = extractWorktreeNameFromPath(initialSpawnDirectory)
    const agentTypeName: string = settings.agents.find(a => a.command === command)?.name ?? ''

    return createTerminalData({
        terminalId,
        attachedToNodeId: contextNodeId,
        terminalCount,
        title,
        anchoredToNodeId: taskNodeId,
        initialCommand: command,
        executeCommand: true,
        initialSpawnDirectory,
        initialEnvVars: expandedEnvVars,
        isPinned: !startUnpinned,
        agentName,
        parentTerminalId: parentTerminalId as TerminalId | null,
        worktreeName,
        isHeadless: headless,
        contextContent: contextNode.contentWithoutYamlOrLinks,
        agentTypeName,
    })
}
