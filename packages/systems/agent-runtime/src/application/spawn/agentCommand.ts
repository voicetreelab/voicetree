import {getDefaultAgent} from '@vt/graph-model/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

export function resolveAgentCommand(
    agentCommand: string | undefined,
    settings: VTSettings,
    taskNodeId: NodeIdAndFilePath,
): string {
    if (!settings) {
        throw new Error(`Failed to load settings for ${taskNodeId}`)
    }

    const agents: readonly { readonly name: string; readonly command: string }[] = settings.agents ?? []
    if (agentCommand !== undefined) {
        const validCommands: Set<string> = new Set(agents.map(a => a.command))
        if (!validCommands.has(agentCommand)) {
            throw new Error('Invalid agent command - must be defined in settings.agents')
        }
    }

    const command: string = agentCommand ?? getDefaultAgent(agents, settings.defaultAgent)?.command ?? ''
    if (!command) {
        throw new Error('No agent command available - settings.agents is empty or undefined')
    }
    return command
}
