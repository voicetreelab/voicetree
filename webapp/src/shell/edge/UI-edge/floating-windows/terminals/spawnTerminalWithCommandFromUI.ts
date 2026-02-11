/** Terminal Flow - V2: Uses types.ts with flat TerminalData type. IDs derived, ui populated after DOM creation. */
import type { NodeIdAndFilePath, GraphNode } from "@/pure/graph";
import type { VTSettings, AgentConfig } from "@/pure/settings";
import { showAgentCommandEditor } from "@/shell/edge/UI-edge/graph/agentCommandEditorPopup";
import type { Core } from "cytoscape";
import '@/shell/electron.d.ts';
import type { TerminalId } from "@/shell/edge/UI-edge/floating-windows/types";
import { getNextTerminalCount, getTerminals } from "@/shell/edge/UI-edge/state/TerminalStore";
import { flushEditorForNode } from "@/shell/edge/UI-edge/floating-windows/editors/flushEditorForNode";
import { getNodeFromMainToUI } from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import { getNodeTitle } from "@/pure/graph/markdown-parsing";
import type { TerminalData } from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import { resolveAgentLaunchConfig, type AgentLaunchConfig } from "@/shell/edge/UI-edge/floating-windows/terminals/resolveAgentLaunchConfig";

const MAX_TERMINALS: number = 12;

/**
 * Spawn a terminal after showing the command editor popup.
 * Always shows the popup regardless of agentPermissionModeChosen setting.
 * Used when user explicitly requests to edit command before running.
 *
 * @param parentNodeId - The parent node to create context for
 * @param cy - Cytoscape instance (used to flush pending editor content)
 * @param agentCommand - Optional agent command. If not provided, uses the default (first) agent from settings.
 */
export async function spawnTerminalWithCommandEditor(
    parentNodeId: NodeIdAndFilePath,
    cy: Core,
    agentCommand?: string,
): Promise<void> {
    // Flush any pending editor content for this node before creating context
    await flushEditorForNode(parentNodeId, cy);

    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();

    // Check terminal limit
    if (terminalsMap.size >= MAX_TERMINALS) {
        alert(`Glad you are trying to power use VT! Limit of ${MAX_TERMINALS} agents at once for now but send over an email 1manumasson@gmail.com if you want to alpha-test higher limits`);
        return;
    }

    // Load settings to get agents and agent prompt
    const settings: VTSettings = await window.electronAPI?.main.loadSettings() as VTSettings;
    if (!settings) {
        console.error('[spawnTerminalWithCommandEditor] Failed to load settings');
        return;
    }

    // Determine the command to use
    const agents: readonly AgentConfig[] = settings.agents ?? [];
    const command: string = agentCommand ?? agents[0]?.command ?? '';
    if (!command) {
        console.error('[spawnTerminalWithCommandEditor] No agent command available');
        return;
    }

    // Get current agent prompt from settings
    const currentAgentPrompt: string = typeof settings.INJECT_ENV_VARS.AGENT_PROMPT === 'string'
        ? settings.INJECT_ENV_VARS.AGENT_PROMPT
        : '';

    // Always show the popup (user explicitly requested edit)
    const result: { command: string; agentPrompt: string; mcpIntegrationEnabled: boolean; useDocker: boolean } | null = await showAgentCommandEditor(command, currentAgentPrompt);

    // User cancelled
    if (result === null) {
        return;
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

    // Save settings if agent prompt changed or command was modified
    const promptChanged: boolean = result.agentPrompt !== currentAgentPrompt;
    if (promptChanged || commandChanged) {
        const updatedSettings: VTSettings = {
            ...settings,
            agents: updatedAgents,
            agentPermissionModeChosen: true,
            INJECT_ENV_VARS: {
                ...settings.INJECT_ENV_VARS,
                AGENT_PROMPT: result.agentPrompt,
            },
        };
        await window.electronAPI?.main.saveSettings(updatedSettings);
    }

    // Update MCP config files based on user's toggle choice and agent type
    await window.electronAPI?.main.setMcpIntegration(result.mcpIntegrationEnabled, result.command);

    const terminalCount: number = getNextTerminalCount(terminalsMap, parentNodeId);

    // Spawn terminal with the (possibly modified) command
    await window.electronAPI?.main.spawnTerminalWithContextNode(
        parentNodeId,
        result.command,
        terminalCount
    );
}

/**
 * Spawn a terminal with a new context node
 *
 * This function now simply delegates to the main process, which orchestrates
 * the entire flow without needing setTimeout hacks. The main process has
 * immediate access to the graph after createContextNode completes.
 *
 * @param parentNodeId - The parent node to create context for
 * @param cy - Cytoscape instance (used to flush pending editor content)
 * @param agentCommand - Optional agent command. If not provided, uses the default (first) agent from settings.
 */
export async function spawnTerminalWithNewContextNode(
    parentNodeId: NodeIdAndFilePath,
    cy: Core,
    agentCommand?: string,
    spawnDirectory?: string,
): Promise<void> {
    // Flush any pending editor content for this node before creating context
    // This ensures the context node has the latest typed content (bypasses 300ms debounce)
    await flushEditorForNode(parentNodeId, cy)

    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();

    // Check terminal limit
    if (terminalsMap.size >= MAX_TERMINALS) {
        alert(`Glad you are trying to power use VT! Limit of ${MAX_TERMINALS} agents at once for now but send over an email 1manumasson@gmail.com if you want to alpha-test higher limits`);
        return;
    }

    // Load settings to get agents and check permission mode
    const settings: VTSettings = await window.electronAPI?.main.loadSettings() as VTSettings;
    if (!settings) {
        console.error('[spawnTerminalWithNewContextNode] Failed to load settings');
        return;
    }

    // Determine the command to use
    const agents: readonly AgentConfig[] = settings.agents ?? [];
    let command: string = agentCommand ?? agents[0]?.command ?? '';
    if (!command) {
        console.error('[spawnTerminalWithNewContextNode] No agent command available');
        return;
    }

    // Show first-run popup if needed, get resolved launch config
    const launchConfig: AgentLaunchConfig = await resolveAgentLaunchConfig(settings, command);

    command = launchConfig.finalCommand;

    // Save settings if permission mode was just chosen
    if (launchConfig.popupWasShown) {
        const updatedSettings: VTSettings = {
            ...settings,
            agents: launchConfig.updatedAgents,
            agentPermissionModeChosen: true,
            INJECT_ENV_VARS: {
                ...settings.INJECT_ENV_VARS,
                AGENT_PROMPT: launchConfig.updatedAgentPrompt,
            },
        };
        await window.electronAPI?.main.saveSettings(updatedSettings);
    }

    // Update MCP config files based on user's toggle choice and agent type
    await window.electronAPI?.main.setMcpIntegration(launchConfig.mcpIntegrationEnabled, command);

    const terminalCount: number = getNextTerminalCount(terminalsMap, parentNodeId);

    // Delegate to main process which has immediate graph access
    await window.electronAPI?.main.spawnTerminalWithContextNode(
        parentNodeId, command, terminalCount, undefined, undefined, undefined, spawnDirectory
    );
}

/**
 * Spawn a terminal in a new git worktree.
 * Creates a worktree named after the node title, then spawns an agent in it.
 */
export async function spawnTerminalInNewWorktree(
    parentNodeId: NodeIdAndFilePath,
    cy: Core,
): Promise<void> {
    // Get node title for worktree name
    const node: GraphNode = await getNodeFromMainToUI(parentNodeId);
    const nodeTitle: string = getNodeTitle(node);

    // Get repo root from watch status
    const watchStatus: { readonly isWatching: boolean; readonly directory: string | undefined } | undefined = await window.electronAPI?.main.getWatchStatus();
    const repoRoot: string | undefined = watchStatus?.directory;
    if (!repoRoot) {
        console.error('[spawnTerminalInNewWorktree] No watched directory available');
        return;
    }

    // Create worktree: generate name from title, then create git worktree
    const worktreeName: string = await window.electronAPI?.main.generateWorktreeName(nodeTitle) as string;
    const worktreePath: string = await window.electronAPI?.main.createWorktree(repoRoot, worktreeName) as string;

    // Delegate to existing spawn function with worktree as spawnDirectory
    return spawnTerminalWithNewContextNode(parentNodeId, cy, undefined, worktreePath);
}

/**
 * Spawn a plain terminal attached to a node (no agent command, no context node)
 *
 * Opens a regular shell terminal anchored to the specified node, useful for
 * manual terminal work without agent automation.
 */
export async function spawnPlainTerminal(
    nodeId: NodeIdAndFilePath,
    _cy: Core,
): Promise<void> {
    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();

    // Check terminal limit
    if (terminalsMap.size >= MAX_TERMINALS) {
        alert(`Glad you are trying to power use VT! Limit of ${MAX_TERMINALS} agents at once for now but send over an email 1manumasson@gmail.com if you want to alpha-test higher limits`);
        return;
    }

    const terminalCount: number = getNextTerminalCount(terminalsMap, nodeId);

    // Delegate to main process
    await window.electronAPI?.main.spawnPlainTerminal(nodeId, terminalCount);
}
