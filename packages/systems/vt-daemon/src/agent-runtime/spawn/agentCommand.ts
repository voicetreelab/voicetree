import {collectResolvableCommands, resolveDefaultAgent} from '@vt/graph-model/settings'
import type {AgentConfig, VTSettings} from '@vt/graph-model/settings'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

/**
 * Resolve the command to launch. A provided command must be one that some leaf
 * of the agent tree resolves to (its env is carried separately via the spawn
 * RPC's `envOverrides`, resolved at the edge). With no command, the default
 * leaf's command is used as a bare fallback — callers that need the default's
 * env resolve it at the edge and pass it through `envOverrides`.
 */
export function resolveAgentCommand(
    agentCommand: string | undefined,
    settings: VTSettings,
    taskNodeId: NodeIdAndFilePath,
): string {
    if (!settings) {
        throw new Error(`Failed to load settings for ${taskNodeId}`)
    }

    const agents: readonly AgentConfig[] = settings.agents ?? []
    if (agentCommand !== undefined) {
        if (!collectResolvableCommands(agents).has(agentCommand)) {
            throw new Error('Invalid agent command - must be a command resolvable from settings.agents')
        }
        return agentCommand
    }

    const command: string = resolveDefaultAgent(agents, settings.defaultAgent)?.command ?? ''
    if (!command) {
        throw new Error('No agent command available - settings.agents is empty or undefined')
    }
    return command
}
