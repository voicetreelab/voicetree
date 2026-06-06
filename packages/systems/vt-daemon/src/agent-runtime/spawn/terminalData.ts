import path from 'path'
import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {getNodeTitle} from '@vt/graph-model/markdown'
import type {VTSettings} from '@vt/graph-model/settings'
import {getUniqueAgentName, pickAgentName} from '@vt/graph-model/settings'
import {createTerminalData, type TerminalData, type TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import {getExistingAgentNames} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/index.ts'
import {buildTerminalEnvVars} from './buildTerminalEnvVars'
import {injectCodexProjectDocDisableFlag} from './injection/codexFlagInjection'
import {getRuntimeGraph, getRuntimeWatchStatus} from '../runtime/graph-bridge'

/**
 * Extract worktree directory name from a spawn path, if it sits under a
 * worktree root directory.
 *
 * Worktree placement is owned by the machine-level git wrapper, not this app,
 * so we only recognise the two ROOT BASENAMES the wrapper uses — we never
 * COMPUTE a path from them:
 *   `vt-wts`        — locally-authored worktrees (not mirrored)
 *   `vt-wts-synced` — part of the mutagen mirror (same basename on Mac + remote)
 *
 * Example: "/Users/x/repos/vt-wts-synced/wt-fix-auth-bug-a3k" -> "wt-fix-auth-bug-a3k"
 */
function extractWorktreeNameFromPath(spawnDirectory: string | undefined): string | undefined {
    if (!spawnDirectory) return undefined
    const markers: readonly string[] = ['/vt-wts/', '/vt-wts-synced/']
    const marker: string | undefined = markers.find(candidate => spawnDirectory.includes(candidate))
    if (!marker) return undefined
    const markerIndex: number = spawnDirectory.indexOf(marker)
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
    const graph: Graph = await getRuntimeGraph()
    // Context nodes are orphaned, so use the taskNodeId directly for the title.
    // The context node lookup is best-effort: the daemon may be mid-rebuild when
    // this fires (file-watcher race after context-node creation writes to disk),
    // and the context node ID is still valid even if not yet visible in getGraph().
    const contextNode: GraphNode | undefined = graph.nodes[contextNodeId]
    const taskNode: GraphNode | undefined = graph.nodes[taskNodeId]
    const title: string = taskNode
        ? getNodeTitle(taskNode)
        : contextNode
            ? getNodeTitle(contextNode)
            : 'Terminal'

    const agentName: string = precomputedAgentName ?? inheritTerminalId ?? (() => {
        const baseAgentName: string = pickAgentName(settings)
        const existingNames: Set<string> = getExistingAgentNames()
        return getUniqueAgentName(baseAgentName, existingNames)
    })()

    const watchStatus: {
        readonly isWatching: boolean
        readonly directory: string | undefined
    } = await getRuntimeWatchStatus()
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

    // Disable Codex's native AGENTS.md project-doc injection (VoiceTree already
    // supplies the task/context prompt). No-op for non-Codex commands. Status
    // reporting is no longer injected into the agent command — agents declare
    // status via create_graph (see updateTerminalStatus).
    const finalCommand: string = injectCodexProjectDocDisableFlag(command)

    return createTerminalData({
        terminalId,
        attachedToNodeId: contextNodeId,
        terminalCount,
        title,
        anchoredToNodeId: taskNodeId,
        initialCommand: finalCommand,
        executeCommand: true,
        initialSpawnDirectory,
        initialEnvVars: expandedEnvVars,
        isPinned: !startUnpinned,
        agentName,
        parentTerminalId: parentTerminalId as TerminalId | null,
        worktreeName,
        isHeadless: headless,
        contextContent: contextNode?.contentWithoutYamlOrLinks ?? '',
        agentTypeName,
    })
}
