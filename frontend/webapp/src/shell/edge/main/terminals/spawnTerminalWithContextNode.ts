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
 *
 * Note: Permission mode prompting is now handled in the renderer
 * (spawnTerminalWithCommandFromUI.ts) before calling this function.
 */

import path from 'path';
import * as O from 'fp-ts/lib/Option.js';
import { createContextNode } from '@/shell/edge/main/graph/context-nodes/createContextNode';
import { getGraph } from '@/shell/edge/main/state/graph-store';
import { loadSettings } from '@/shell/edge/main/settings/settings_IO';
import { getWatchStatus, getWritePath, getVaultPaths } from '@/shell/edge/main/graph/watch_folder/watchFolder';
import { getAppSupportPath } from '@/shell/edge/main/state/app-electron-state';
import { uiAPI } from '@/shell/edge/main/ui-api-proxy';
import { createTerminalData, getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { NodeIdAndFilePath, GraphNode, Graph } from '@/pure/graph';
import { getNodeTitle } from '@/pure/graph/markdown-parsing';
import { findFirstParentNode } from '@/pure/graph/graph-operations/findFirstParentNode';
import type { VTSettings } from '@/pure/settings';
import { resolveEnvVars, expandEnvVarsInValues } from '@/pure/settings';
import { getNextTerminalCountForNode } from '@/shell/edge/main/terminals/terminal-registry';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import { createWorktree, generateWorktreeName } from '@/shell/edge/main/worktree/gitWorktreeCommands';

/**
 * Spawn a terminal with a context node, orchestrated from main process
 *
 * This function replaces the UI-side spawnTerminalWithNewContextNode,
 * eliminating the setTimeout hack by keeping all orchestration in the
 * main process where graph state is immediately available.
 *
 * @param parentNodeId - The parent node to create context for
 * @param agentCommand - The agent command to run (already processed by renderer for permission mode)
 * @param terminalCount - Current terminal count from UI TerminalStore
 * @param skipFitAnimation - If true, skip navigating viewport to the terminal (used for MCP spawns)
 * @param startUnpinned - If true, terminal starts unpinned (used for MCP spawns)
 */
export async function spawnTerminalWithContextNode(
    parentNodeId: NodeIdAndFilePath,
    agentCommand: string | undefined,
    terminalCount?: number,
    skipFitAnimation?: boolean,
    startUnpinned?: boolean,
    inNewWorktree?: boolean
): Promise<{terminalId: string; contextNodeId: NodeIdAndFilePath}> {
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

    // Create or reuse context node, and determine task node for anchoring
    let contextNodeId: NodeIdAndFilePath;
    let taskNodeId: NodeIdAndFilePath;
    if (parentNode.nodeUIMetadata.isContextNode) {
        // Reuse existing context node
        contextNodeId = parentNodeId;
        // Task node is the parent of the context node
        const taskNode: GraphNode | undefined = findFirstParentNode(parentNode, graph);
        taskNodeId = taskNode?.absoluteFilePathIsID ?? parentNodeId;
    } else {
        // Create context node for the parent
        contextNodeId = await createContextNode(parentNodeId);
        // The clicked node IS the task node
        taskNodeId = parentNodeId;
    }

    // Prepare terminal data (main has immediate access to all state)
    const resolvedTerminalCount: number = typeof terminalCount === 'number'
        ? terminalCount
        : getNextTerminalCountForNode(contextNodeId)

    const terminalData: TerminalData = await prepareTerminalDataInMain(
        contextNodeId,
        taskNodeId,
        resolvedTerminalCount,
        command,
        settings,
        startUnpinned
    );

    // TODO, HERE WE NEED TO WAIT FOR CONTEXT NODE TO EXIST IN UI
    // OR we could move that to within launchTerminalOntoUI
    // Actually, this is handled in createFloatingTerminal via waitForNode: src/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI.ts:371

    // Call UI to launch terminal (via UI API pattern)
    // Note: uiAPI sends IPC message, no need to await (fire-and-forget)
    void uiAPI.launchTerminalOntoUI(contextNodeId, terminalData, skipFitAnimation);

    return {
        terminalId: getTerminalId(terminalData),
        contextNodeId
    }
}

/**
 * Prepare terminal data in main process
 *
 * Equivalent to the UI-side prepareTerminalData function, but using
 * main process state access (graph-store, settings, watchFolder).
 *
 * @param contextNodeId - The context node containing agent context (attachedToNodeId)
 * @param taskNodeId - The task node to anchor the terminal shadow to (anchoredToNodeId)
 */
async function prepareTerminalDataInMain(
    contextNodeId: NodeIdAndFilePath,
    taskNodeId: NodeIdAndFilePath,
    terminalCount: number,
    command: string,
    settings: VTSettings,
    startUnpinned?: boolean
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

    // Build terminal title from parent node title
    // Context nodes have title "context", so we use the parent node's title instead
    // (the task node that spawned this context node)
    const parentNode: GraphNode | undefined = findFirstParentNode(contextNode, graph);
    const title: string = parentNode ? getNodeTitle(parentNode) : getNodeTitle(contextNode);

    // Compute initial_spawn_directory from watch directory + relative path setting
    let initialSpawnDirectory: string | undefined;
    const watchStatus: {
        readonly isWatching: boolean;
        readonly directory: string | undefined;
    } = getWatchStatus();

    initialSpawnDirectory = watchStatus.directory;

    if (watchStatus?.directory && settings.terminalSpawnPathRelativeToWatchedDirectory) {
        // Use path.join for cross-platform path handling
        const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
        initialSpawnDirectory = path.join(watchStatus.directory, relativePath);
    }

    // Get app support path for VOICETREE_APP_SUPPORT env var
    const appSupportPath: string = getAppSupportPath();

    // Node IDs are now absolute paths - use directly
    const contextNodeAbsolutePath: string = contextNodeId;

    // Task node path (parent of context node) - also absolute
    const taskNodeAbsolutePath: string = parentNode
        ? parentNode.absoluteFilePathIsID
        : '';

    // Build env vars then expand $VAR_NAME references within values
    // Truncate context content to avoid posix_spawnp failure from env size limits
    // Full content is available at CONTEXT_NODE_PATH
    const MAX_CONTEXT_CONTENT_LENGTH: number = 64000;
    const truncatedContextContent: string = contextContent.length > MAX_CONTEXT_CONTENT_LENGTH
        ? contextContent.slice(0, MAX_CONTEXT_CONTENT_LENGTH) + '\n\n[Content truncated - full content available at $CONTEXT_NODE_PATH]'
        : contextContent;

    // Get write path (where new nodes are created)
    const vaultPath: string = O.getOrElse(() => '')(await getWritePath());

    // Get all vault paths for ALL_MARKDOWN_READ_PATHS (newline-separated for readability in prompts)
    const allVaultPaths: readonly string[] = await getVaultPaths();
    const allMarkdownReadPaths: string = allVaultPaths.join('\n');

    // Generate terminal ID before creating TerminalData so we can include it in env vars
    const terminalId: string = `terminal-${contextNodeId}-${terminalCount}`;

    const unexpandedEnvVars: Record<string, string> = {
        VOICETREE_APP_SUPPORT: appSupportPath ?? '',
        VOICETREE_VAULT_PATH: vaultPath,
        ALL_MARKDOWN_READ_PATHS: allMarkdownReadPaths,
        CONTEXT_NODE_PATH: contextNodeAbsolutePath,
        TASK_NODE_PATH: taskNodeAbsolutePath,
        CONTEXT_NODE_CONTENT: truncatedContextContent,
        VOICETREE_TERMINAL_ID: terminalId,
        ...resolvedEnvVars,
    };
    const expandedEnvVars: Record<string, string> = expandEnvVarsInValues(unexpandedEnvVars);

    // Create TerminalData using the factory function (flat type, no nested floatingWindow)
    // anchoredToNodeId = taskNodeId (shadow node connects to task node)
    // attachedToNodeId = contextNodeId (for metadata, env vars, and shadow→context edge)
    const terminalData: TerminalData = createTerminalData({
        attachedToNodeId: contextNodeId,
        terminalCount: terminalCount,
        title: title,
        anchoredToNodeId: taskNodeId,
        initialCommand: command,
        executeCommand: true,
        initialSpawnDirectory: initialSpawnDirectory,
        initialEnvVars: expandedEnvVars,
        isPinned: !startUnpinned,
    });

    return terminalData;
}
