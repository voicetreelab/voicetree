import {flattenAgentTree} from '@vt/graph-model/settings'
import type {AgentConfig, ResolvedAgent, VTSettings} from '@vt/graph-model/settings'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

function resolveDefaultLeaf(leaves: readonly ResolvedAgent[], defaultAgentName?: string): ResolvedAgent | undefined {
    if (defaultAgentName) {
        return leaves.find(leaf => leaf.label === defaultAgentName)
            ?? leaves.find(leaf => leaf.name === defaultAgentName)
            ?? leaves[0]
    }
    return leaves[0]
}

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
    const leaves: readonly ResolvedAgent[] = flattenAgentTree(agents)
    if (agentCommand !== undefined) {
        const resolvable: Set<string> = new Set(leaves.map(leaf => leaf.command).filter(command => command.length > 0))
        if (!resolvable.has(agentCommand)) {
            throw new Error('Invalid agent command - must be a command resolvable from settings.agents')
        }
        return agentCommand
    }

    const command: string = resolveDefaultLeaf(leaves, settings.defaultAgent)?.command ?? ''
    if (!command) {
        throw new Error('No agent command available - settings.agents is empty or undefined')
    }
    return command
}
