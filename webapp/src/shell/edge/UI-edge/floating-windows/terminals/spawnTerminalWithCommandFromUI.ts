/** Terminal Flow - V2: Uses types.ts with flat TerminalData type. IDs derived, ui populated after DOM creation. */
import type { NodeIdAndFilePath, GraphNode } from "@vt/graph-model/graph";
import type { VTSettings, AgentConfig } from "@vt/graph-model/settings";
import { resolveDefaultAgent, mapAgentTreeByCommand, type ResolvedAgent } from "@vt/graph-model/settings";
import { showAgentCommandEditor } from "@/shell/edge/UI-edge/graph/popups/agentCommandEditorPopup";
import type { Core } from "cytoscape";
import '@/shell/hostApi.d.ts';
import type { TerminalId } from "@/shell/edge/UI-edge/floating-windows/anchoring/types";
import { getNextTerminalCount, getTerminals } from "@/shell/edge/UI-edge/state/stores/TerminalStore";
import { flushEditorForNode } from "@/shell/edge/UI-edge/floating-windows/editors/flushEditorForNode";
import { getNodeFromMainToUI } from "@/shell/edge/UI-edge/graph/view/getNodeFromMainToUI";
import { getNodeTitle } from "@vt/graph-model/markdown";
import type { TerminalData } from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import { hostCapabilities } from "@/shell/runtimeCapabilities";
import { resolveAgentLaunchConfig, type AgentLaunchConfig } from "@/shell/edge/UI-edge/floating-windows/terminals/resolveAgentLaunchConfig";

const MAX_TERMINALS: number = 100; // human: raised for dev/power-use; original was 12

/**
 * Spawn a terminal after showing the command editor popup.
 * Always shows the popup regardless of agentPermissionModeChosen setting.
 * Used when user explicitly requests to edit command before running.
 *
 * @param parentNodeId - The parent node to create context for
 * @param _cy - Cytoscape instance (unused; kept for call-site signature parity)
 * @param agentCommand - Optional agent command. If not provided, uses the default agent from settings.
 */
export async function spawnTerminalWithCommandEditor(
    parentNodeId: NodeIdAndFilePath,
    _cy: Core,
    agentCommand?: string,
): Promise<void> {
    // Flush any pending editor content for this node before creating context
    await flushEditorForNode(parentNodeId);

    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();

    // Check terminal limit
    if (terminalsMap.size >= MAX_TERMINALS) {
        alert(`Glad you are trying to power use VT! Limit of ${MAX_TERMINALS} agents at once for now but send over an email 1manumasson@gmail.com if you want to alpha-test higher limits`);
        return;
    }

    // Load settings to get agents and agent prompt
    const settings: VTSettings = await window.hostAPI?.main.loadSettings() as VTSettings;
    if (!settings) {
        console.error('[spawnTerminalWithCommandEditor] Failed to load settings');
        return;
    }

    // Determine the command to use
    const agents: readonly AgentConfig[] = settings.agents ?? [];
    const command: string = agentCommand ?? resolveDefaultAgent(agents, settings.defaultAgent)?.command ?? '';
    if (!command) {
        console.error('[spawnTerminalWithCommandEditor] No agent command available');
        return;
    }

    // Get current agent prompt from settings
    const currentAgentPrompt: string = typeof settings.INJECT_ENV_VARS.AGENT_PROMPT === 'string'
        ? settings.INJECT_ENV_VARS.AGENT_PROMPT
        : '';

    // Always show the popup (user explicitly requested edit)
    const result: { command: string; agentPrompt: string; useDocker: boolean } | null = await showAgentCommandEditor(command, currentAgentPrompt);

    // User cancelled
    if (result === null) {
        return;
    }

    // Check if user modified the command
    const commandChanged: boolean = result.command !== command;

    // Update the tree node(s) whose command matches the original, at any depth.
    const updatedAgents: readonly AgentConfig[] = commandChanged
        ? mapAgentTreeByCommand(settings.agents, command, result.command)
        : settings.agents;

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
        await window.hostAPI?.main.saveSettings(updatedSettings);
    }

    const terminalCount: number = getNextTerminalCount(terminalsMap, parentNodeId);

    // Spawn terminal with the (possibly modified) command
    await window.hostAPI?.main.spawnTerminalWithContextNode({
        taskNodeId: parentNodeId,
        agentCommand: result.command,
        terminalCount,
    });
}

/**
 * Spawn a terminal with a new context node
 *
 * This function now simply delegates to the main process, which orchestrates
 * the entire flow without needing setTimeout hacks. The main process has
 * immediate access to the graph after createContextNode completes.
 *
 * @param parentNodeId - The parent node to create context for
 * @param _cy - Cytoscape instance (unused; kept for call-site signature parity)
 * @param agentCommand - Optional agent command. If not provided, uses the default agent from settings.
 */
export async function spawnTerminalWithNewContextNode(
    parentNodeId: NodeIdAndFilePath,
    _cy: Core,
    agentCommand?: string,
    spawnDirectory?: string,
    envOverrides?: Readonly<Record<string, string>>,
): Promise<void> {
    // Flush any pending editor content for this node before creating context
    // This ensures the context node has the latest typed content (bypasses 300ms debounce)
    await flushEditorForNode(parentNodeId)

    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();

    // Check terminal limit
    if (terminalsMap.size >= MAX_TERMINALS) {
        alert(`Glad you are trying to power use VT! Limit of ${MAX_TERMINALS} agents at once for now but send over an email 1manumasson@gmail.com if you want to alpha-test higher limits`);
        return;
    }

    // Load settings to get agents and check permission mode
    const settings: VTSettings = await window.hostAPI?.main.loadSettings() as VTSettings;
    if (!settings) {
        console.error('[spawnTerminalWithNewContextNode] Failed to load settings');
        return;
    }

    // Determine the command + env to use. An explicit command (from a resolved
    // leaf or the worktree run) is launched as-is with the caller's envOverrides.
    // With no command we resolve the default leaf and carry ITS env too, so a
    // default that "just adds a parameter" still gets it (caller env wins).
    const agents: readonly AgentConfig[] = settings.agents ?? [];
    let command: string;
    let resolvedEnv: Record<string, string>;
    if (agentCommand !== undefined) {
        command = agentCommand;
        resolvedEnv = {...envOverrides};
    } else {
        const defaultAgent: ResolvedAgent | undefined = resolveDefaultAgent(agents, settings.defaultAgent);
        command = defaultAgent?.command ?? '';
        resolvedEnv = {...defaultAgent?.env, ...envOverrides};
    }
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
        await window.hostAPI?.main.saveSettings(updatedSettings);
    }

    const terminalCount: number = getNextTerminalCount(terminalsMap, parentNodeId);

    // Delegate to main process which has immediate graph access. The resolved
    // env rides the spawn RPC's envOverrides channel -> tmux `-e KEY=VALUE`.
    await window.hostAPI?.main.spawnTerminalWithContextNode({
        taskNodeId: parentNodeId,
        agentCommand: command,
        terminalCount,
        spawnDirectory,
        ...(Object.keys(resolvedEnv).length > 0 ? {envOverrides: resolvedEnv} : {}),
    });
}

/**
 * Spawn a terminal in a new git worktree.
 * Creates a worktree named after the node title, then spawns an agent in it.
 */
export async function spawnTerminalInNewWorktree(
    parentNodeId: NodeIdAndFilePath,
    cy: Core,
): Promise<void> {
    // Backstop: the "New Worktree" entry that calls this is hidden in browser
    // mode (worktree menu gated), so this should be unreachable there.
    if (!hostCapabilities().worktrees) return;

    // Get node title for worktree name
    const node: GraphNode = await getNodeFromMainToUI(parentNodeId);
    const nodeTitle: string = getNodeTitle(node);

    // Get repo root from watch status
    const watchStatus: { readonly isWatching: boolean; readonly directory: string | undefined } | undefined = await window.hostAPI?.main.getWatchStatus();
    const repoRoot: string | undefined = watchStatus?.directory;
    if (!repoRoot) {
        console.error('[spawnTerminalInNewWorktree] No watched directory available');
        return;
    }

    // Create worktree: generate name from title, then create git worktree
    const worktreeName: string = await window.hostAPI?.main.generateWorktreeName(nodeTitle) as string;
    const worktreePath: string = await window.hostAPI?.main.createWorktree(repoRoot, worktreeName) as string;

    // Delegate to existing spawn function with worktree as spawnDirectory
    return spawnTerminalWithNewContextNode(parentNodeId, cy, undefined, worktreePath);
}
