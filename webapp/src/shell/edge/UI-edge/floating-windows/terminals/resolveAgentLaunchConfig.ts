import type { VTSettings, AgentConfig } from "@/pure/settings";
import { showAgentCommandEditor } from "@/shell/edge/UI-edge/graph/agentCommandEditorPopup";

export interface AgentLaunchConfig {
    finalCommand: string;
    popupWasShown: boolean;
    updatedAgents: readonly AgentConfig[];
    updatedAgentPrompt: string;
    mcpIntegrationEnabled: boolean;
    useDocker: boolean;
}

/** Shows first-run popup if needed. Returns resolved agent launch configuration. */
export async function resolveAgentLaunchConfig(
    settings: VTSettings,
    command: string
): Promise<AgentLaunchConfig> {
    // Get current agent prompt from settings
    const currentAgentPrompt: string = typeof settings.INJECT_ENV_VARS.AGENT_PROMPT === 'string'
        ? settings.INJECT_ENV_VARS.AGENT_PROMPT
        : '';

    // Only prompt for Claude agent and only if not already chosen
    const isClaudeAgent: boolean = command.toLowerCase().includes('claude');
    if (settings.agentPermissionModeChosen || !isClaudeAgent) {
        return {
            finalCommand: command, popupWasShown: false, updatedAgents: settings.agents,
            updatedAgentPrompt: currentAgentPrompt, mcpIntegrationEnabled: true, useDocker: false,
        };
    }

    // Show the agent command editor popup with both command and agent prompt
    const result: ReturnType<typeof showAgentCommandEditor> extends Promise<infer T> ? T : never = await showAgentCommandEditor(command, currentAgentPrompt);

    // User cancelled - return original values but mark as chosen to not prompt again
    if (result === null) {
        return {
            finalCommand: command, popupWasShown: true, updatedAgents: settings.agents,
            updatedAgentPrompt: currentAgentPrompt, mcpIntegrationEnabled: true, useDocker: false,
        };
    }

    // Check if user modified the command
    const commandChanged: boolean = result.command !== command;

    // Update the agent's command in settings if it was modified
    let updatedAgents: readonly AgentConfig[] = settings.agents;
    if (commandChanged) {
        updatedAgents = settings.agents.map((agent: AgentConfig): AgentConfig => {
            // Update the agent whose command matches the original command
            if (agent.command === command) {
                return {
                    ...agent,
                    command: result.command,
                };
            }
            return agent;
        });
    }

    return {
        finalCommand: result.command, popupWasShown: true, updatedAgents,
        updatedAgentPrompt: result.agentPrompt, mcpIntegrationEnabled: result.mcpIntegrationEnabled,
        useDocker: result.useDocker,
    };
}
