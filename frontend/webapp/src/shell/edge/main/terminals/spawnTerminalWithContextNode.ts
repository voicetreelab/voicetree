/**
 * Terminal spawning orchestrator in main process
 *
 * Eliminates the 1-second setTimeout hack by coordinating terminal spawning
 * in the main process where graph state is immediately available after
 * createContextNode completes.
 *
 * Flow:
 * 1. Main process creates context node (has immediate graph access)
 * 2. Main process prepares terminal data (reads settings, env vars, etc.)
 * 3. Main process calls UI via uiAPI.launchTerminalOntoUI()
 * 4. UI renders terminal with Cytoscape
 */

import { createContextNode } from '@/shell/edge/main/graph/context-nodes/createContextNode';
import { getGraph } from '@/shell/edge/main/state/graph-store';
import { loadSettings, saveSettings } from '@/shell/edge/main/settings/settings_IO';
import { getWatchStatus, getWatchedDirectory } from '@/shell/edge/main/graph/watchFolder';
import { getAppSupportPath } from '@/shell/edge/main/state/app-electron-state';
import { uiAPI } from '@/shell/edge/main/ui-api-proxy';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/types';
import { createTerminalData } from '@/shell/edge/UI-edge/floating-windows/types';
import type { NodeIdAndFilePath, GraphNode, Graph } from '@/pure/graph';
import { getNodeTitle } from '@/pure/graph/markdown-parsing';
import { findFirstParentNode } from '@/pure/graph/graph-operations/findFirstParentNode';
import type { VTSettings, AgentConfig } from '@/pure/settings';
import { resolveEnvVars, expandEnvVarsInValues } from '@/pure/settings';
import { getRandomAgentName } from '@/pure/settings/types';
import { dialog } from 'electron';

/**
 * Get the user's permission mode choice.
 * In test mode (AGENT_PERMISSION_TEST_RESPONSE env var), returns the test response.
 * In production, shows an Electron dialog.
 *
 * @returns 0 for Auto-run, 1 for Safe Mode
 */
async function getPermissionModeChoice(): Promise<number> {
    // Test mode: use env var to specify response (avoids blocking dialog in tests)
    const testResponse: string | undefined = process.env['AGENT_PERMISSION_TEST_RESPONSE'];
    if (testResponse !== undefined) {
        console.log(`[Permission] Test mode: using response "${testResponse}"`);
        return testResponse === 'auto-run' ? 0 : 1;
    }

    // Production: show dialog
    const result: Electron.MessageBoxReturnValue = await dialog.showMessageBox({
        type: 'question',
        title: 'Agent Permission Mode',
        message: 'How should Claude agents run?',
        detail: 'Auto-run mode will add `dangerously-skip-permissions` to the agent command, allowing it execute commands without asking for permission each time. This is recommended for VoiceTree workflows.\n\nYou can change this in settings at any time.',
        buttons: ['Auto-run', 'Safe Mode'],
        defaultId: 0,
        cancelId: 1,
    });

    return result.response;
}

/**
 * Check if user has chosen agent permission mode, prompt if not.
 * Returns the (possibly updated) command to use.
 *
 * For Claude agents, prompts user to choose between:
 * - Safe mode: requires manual approval for each action
 * - Auto-run (recommended): bypasses permission prompts
 */
async function ensureAgentPermissionModeChosen(
    settings: VTSettings,
    command: string
): Promise<{ updatedCommand: string; updatedSettings: VTSettings }> {
    // Only prompt for Claude agent and only if not already chosen
    const isClaudeAgent: boolean = command.toLowerCase().includes('claude');
    if (settings.agentPermissionModeChosen || !isClaudeAgent) {
        return { updatedCommand: command, updatedSettings: settings };
    }

    const choiceResponse: number = await getPermissionModeChoice();
    const choseAutoRun: boolean = choiceResponse === 0;

    let updatedCommand: string = command;
    let updatedAgents: readonly AgentConfig[] = settings.agents;

    if (choseAutoRun) {
        // Add --dangerously-skip-permissions to Claude command
        updatedCommand = command.replace(
            /^claude\s+/,
            'claude --dangerously-skip-permissions '
        );

        // Update Claude agent in settings
        updatedAgents = settings.agents.map((agent: AgentConfig): AgentConfig => {
            if (agent.name === 'Claude' || agent.command.toLowerCase().includes('claude')) {
                return {
                    ...agent,
                    command: agent.command.replace(
                        /^claude\s+/,
                        'claude --dangerously-skip-permissions '
                    ),
                };
            }
            return agent;
        });
    }

    // Save settings with choice recorded
    const updatedSettings: VTSettings = {
        ...settings,
        agents: updatedAgents,
        agentPermissionModeChosen: true,
    };
    await saveSettings(updatedSettings);

    return { updatedCommand, updatedSettings };
}

/**
 * Spawn a terminal with a context node, orchestrated from main process
 *
 * This function replaces the UI-side spawnTerminalWithNewContextNode,
 * eliminating the setTimeout hack by keeping all orchestration in the
 * main process where graph state is immediately available.
 *
 * @param parentNodeId - The parent node to create context for
 * @param agentCommand - Optional agent command. If not provided, uses default agent from settings
 * @param terminalCount - Current terminal count from UI TerminalStore
 */
export async function spawnTerminalWithContextNode(
    parentNodeId: NodeIdAndFilePath,
    agentCommand: string | undefined,
    terminalCount: number
): Promise<void> {
    // Load settings to get agents
    let settings: VTSettings = await loadSettings();
    if (!settings) {
        throw new Error(`Failed to load settings for ${parentNodeId}`);
    }

    // Use provided command or default to first agent
    const agents: readonly { readonly name: string; readonly command: string }[] = settings.agents ?? [];
    let command: string = agentCommand ?? agents[0]?.command ?? '';
    if (!command) {
        throw new Error('No agent command available - settings.agents is empty or undefined');
    }

    // Check if user needs to choose permission mode (first-time prompt for Claude)
    const permissionResult: { updatedCommand: string; updatedSettings: VTSettings } =
        await ensureAgentPermissionModeChosen(settings, command);
    command = permissionResult.updatedCommand;
    settings = permissionResult.updatedSettings;

    // Get parent node from graph
    const graph: Graph = getGraph();
    const parentNode: GraphNode = graph.nodes[parentNodeId];
    if (!parentNode) {
        throw new Error(`Node ${parentNodeId} not found in graph`);
    }

    // Create or reuse context node
    let contextNodeId: NodeIdAndFilePath;
    if (parentNode.nodeUIMetadata.isContextNode) {
        // Reuse existing context node
        contextNodeId = parentNodeId;
    } else {
        // Create context node for the parent
        contextNodeId = await createContextNode(parentNodeId);
    }

    // Prepare terminal data (main has immediate access to all state)
    const terminalData: TerminalData = await prepareTerminalDataInMain(
        contextNodeId,
        terminalCount,
        command,
        settings
    );

    // Call UI to launch terminal (via UI API pattern)
    // Note: uiAPI sends IPC message, no need to await (fire-and-forget)
    void uiAPI.launchTerminalOntoUI(contextNodeId, terminalData);
}

/**
 * Prepare terminal data in main process
 *
 * Equivalent to the UI-side prepareTerminalData function, but using
 * main process state access (graph-store, settings, watchFolder).
 */
async function prepareTerminalDataInMain(
    contextNodeId: NodeIdAndFilePath,
    terminalCount: number,
    command: string,
    settings: VTSettings
): Promise<TerminalData> {
    // Get context node from graph (main has immediate access)
    const graph: Graph = getGraph();
    const contextNode: GraphNode = graph.nodes[contextNodeId];
    if (!contextNode) {
        throw new Error(`Context node ${contextNodeId} not found in graph`);
    }

    const contextContent: string = contextNode.contentWithoutYamlOrLinks;

    // Resolve env vars (including random AGENT_NAME selection)
    const resolvedEnvVars: Record<string, string> = resolveEnvVars(settings.INJECT_ENV_VARS);

    // Build terminal title: "<AGENT_NAME>: <parent_node_title>"
    // Context nodes have title "context", so we use the parent node's title instead
    // (the task node that spawned this context node)
    const parentNode: GraphNode | undefined = findFirstParentNode(contextNode, graph);
    const parentTitle: string = parentNode ? getNodeTitle(parentNode) : getNodeTitle(contextNode);
    const agentName: string = getRandomAgentName();
    const title: string = `${agentName}: ${parentTitle}`;

    // Compute initial_spawn_directory from watch directory + relative path setting
    let initialSpawnDirectory: string | undefined;
    const watchStatus: {
        readonly isWatching: boolean;
        readonly directory: string | undefined;
    } = getWatchStatus();

    initialSpawnDirectory = watchStatus.directory;

    if (watchStatus?.directory && settings.terminalSpawnPathRelativeToWatchedDirectory) {
        // Simple path join: remove trailing slash from directory, remove leading ./ from relative path
        const baseDir: string = watchStatus.directory.replace(/\/$/, '');
        const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
        initialSpawnDirectory = `${baseDir}/${relativePath}`;
    }

    // Get app support path for VOICETREE_APP_SUPPORT env var
    const appSupportPath: string = getAppSupportPath();

    // Build absolute path for context node (using watched directory, since nodeId is relative to it)
    const watchedDir: string | null = getWatchedDirectory();
    const contextNodeAbsolutePath: string = watchedDir
        ? `${watchedDir.replace(/\/$/, '')}/${contextNodeId}`
        : contextNodeId;

    // Build absolute path for task node (parent of context node)
    const taskNodeAbsolutePath: string = parentNode && watchedDir
        ? `${watchedDir.replace(/\/$/, '')}/${parentNode.relativeFilePathIsID}`
        : '';

    // Build env vars then expand $VAR_NAME references within values
    // Truncate context content to avoid posix_spawnp failure from env size limits
    // Full content is available at CONTEXT_NODE_PATH
    const MAX_CONTEXT_CONTENT_LENGTH: number = 64000;
    const truncatedContextContent: string = contextContent.length > MAX_CONTEXT_CONTENT_LENGTH
        ? contextContent.slice(0, MAX_CONTEXT_CONTENT_LENGTH) + '\n\n[Content truncated - full content available at $CONTEXT_NODE_PATH]'
        : contextContent;

    const unexpandedEnvVars: Record<string, string> = {
        VOICETREE_APP_SUPPORT: appSupportPath ?? '',
        CONTEXT_NODE_PATH: contextNodeAbsolutePath,
        TASK_NODE_PATH: taskNodeAbsolutePath,
        CONTEXT_NODE_CONTENT: truncatedContextContent,
        ...resolvedEnvVars,
    };
    const expandedEnvVars: Record<string, string> = expandEnvVarsInValues(unexpandedEnvVars);

    // Create TerminalData using the factory function (flat type, no nested floatingWindow)
    const terminalData: TerminalData = createTerminalData({
        attachedToNodeId: contextNodeId,
        terminalCount: terminalCount,
        title: title,
        anchoredToNodeId: contextNodeId, // Will be wrapped in O.some by factory
        initialCommand: command,
        executeCommand: true,
        initialSpawnDirectory: initialSpawnDirectory,
        initialEnvVars: expandedEnvVars,
    });

    return terminalData;
}
