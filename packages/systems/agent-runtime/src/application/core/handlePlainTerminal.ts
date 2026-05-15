import path from 'path'
import type {Command} from '../domain/command.ts'
import type {
    CreateTerminalDataParams,
    NodeIdAndFilePath,
    TerminalId,
    VTSettings,
} from '../domain/session.ts'

export type PlainTerminalInput = {
    nodeId: NodeIdAndFilePath
    terminalCount: number
    title: string
    settings: VTSettings
    watchDirectory: string | undefined
    agentName: string
    expandedEnvVars: Record<string, string>
}

export type PlainTerminalResponse = {
    terminalId: TerminalId
    terminalDataParams: CreateTerminalDataParams
}

export function handlePlainTerminal(
    input: PlainTerminalInput,
): { state: CreateTerminalDataParams; commands: Command[]; response: PlainTerminalResponse } {
    const initialSpawnDirectory: string | undefined = resolveInitialSpawnDirectory(
        input.watchDirectory,
        input.settings,
    )
    const terminalId: TerminalId = input.agentName as TerminalId
    const terminalDataParams: CreateTerminalDataParams = {
        terminalId,
        attachedToNodeId: input.nodeId,
        terminalCount: input.terminalCount,
        title: input.title,
        anchoredToNodeId: input.nodeId,
        executeCommand: false,
        initialSpawnDirectory,
        initialEnvVars: input.expandedEnvVars,
        agentName: input.agentName,
    }

    return {
        state: terminalDataParams,
        commands: [
            {
                type: 'LaunchTerminalOntoUI',
                launch: {
                    nodeId: input.nodeId,
                    terminalDataParams,
                },
            },
        ],
        response: {terminalId, terminalDataParams},
    }
}

function resolveInitialSpawnDirectory(
    watchDirectory: string | undefined,
    settings: VTSettings,
): string | undefined {
    if (!watchDirectory) return undefined
    if (!settings.terminalSpawnPathRelativeToWatchedDirectory) {
        return watchDirectory
    }
    const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '')
    return path.join(watchDirectory, relativePath)
}
