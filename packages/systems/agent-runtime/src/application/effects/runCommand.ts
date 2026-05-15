import type {Command} from '../domain/command.ts'
import {getRuntimeUI} from '@vt/agent-runtime'
import {applyRuntimeGraphDelta} from '@vt/agent-runtime/runtime/graph-bridge'
import {createTerminalData, type TerminalData} from '@vt/agent-runtime/terminals/terminal-registry/types.ts'

export async function runCommand(command: Command): Promise<void> {
    switch (command.type) {
        case 'LaunchTerminalOntoUI': {
            const terminalData: TerminalData = createTerminalData(command.launch.terminalDataParams)
            getRuntimeUI().launchTerminalOntoUI?.(command.launch.nodeId, terminalData)
            return
        }
        case 'ApplyRuntimeGraphDelta':
            await applyRuntimeGraphDelta(command.graphDelta)
            return
        default: {
            const _exhaustive: never = command
            return _exhaustive
        }
    }
}
