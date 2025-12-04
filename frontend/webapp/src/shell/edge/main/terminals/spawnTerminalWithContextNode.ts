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
import { loadSettings } from '@/shell/edge/main/settings/settings_IO';
import { getWatchStatus } from '@/shell/edge/main/graph/watchFolder';
import { getAppSupportPath } from '@/shell/edge/main/state/app-electron-state';
import { uiAPI } from '@/shell/edge/main/ui-api-proxy';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/types';
import { createTerminalData } from '@/shell/edge/UI-edge/floating-windows/types';
import type { NodeIdAndFilePath, GraphNode, Graph } from '@/pure/graph';
import { getNodeTitle } from '@/pure/graph/markdown-parsing';
import type { VTSettings } from '@/pure/settings';
import { resolveEnvVars, expandEnvVarsInValues } from '@/pure/settings';

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
    const settings: VTSettings = await loadSettings();
    if (!settings) {
        throw new Error(`Failed to load settings for ${parentNodeId}`);
    }

    // Use provided command or default to first agent
    const agents: readonly { readonly name: string; readonly command: string }[] = settings.agents ?? [];
    const command: string = agentCommand ?? agents[0]?.command ?? '';
    if (!command) {
        throw new Error('No agent command available - settings.agents is empty or undefined');
    }

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

    console.log("BEFORE LAUNCH") // we never get here if we go down createContextNode path. Why?

    // Call UI to launch terminal (via UI API pattern)
    // Note: uiAPI sends IPC message, no need to await (fire-and-forget)
    void uiAPI.launchTerminalOntoUI(contextNodeId, terminalData);

    console.log("AFTER LAUNCH")

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

    // Build terminal title: "<AGENT_NAME>: <context_node_name_without_prefix>"
    const contextNodeTitle: string = getNodeTitle(contextNode);
    const strippedTitle: string = contextNodeTitle.replace(/^CONTEXT for:\s*/i, '');
    const agentName: string = resolvedEnvVars['AGENT_NAME'] ?? '';
    const title: string = agentName ? `${agentName}: ${strippedTitle}` : strippedTitle;

    // Compute initial_spawn_directory from watch directory + relative path setting
    let initialSpawnDirectory: string | undefined;
    const watchStatus: {
        readonly isWatching: boolean;
        readonly directory: string | undefined;
    } = getWatchStatus();

    if (watchStatus?.directory && settings.terminalSpawnPathRelativeToWatchedDirectory) {
        // Simple path join: remove trailing slash from directory, remove leading ./ from relative path
        const baseDir: string = watchStatus.directory.replace(/\/$/, '');
        const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
        initialSpawnDirectory = `${baseDir}/${relativePath}`;
    }

    // Get app support path for VOICETREE_APP_SUPPORT env var
    const appSupportPath: string = getAppSupportPath();

    // Build absolute path for context node
    const contextNodeAbsolutePath: string = watchStatus?.directory
        ? `${watchStatus.directory.replace(/\/$/, '')}/${contextNodeId}`
        : contextNodeId;

    // Build env vars then expand $VAR_NAME references within values
    const unexpandedEnvVars: Record<string, string> = {
        VOICETREE_APP_SUPPORT: appSupportPath ?? '',
        CONTEXT_NODE_PATH: contextNodeAbsolutePath,
        CONTEXT_NODE_CONTENT: contextContent,
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
