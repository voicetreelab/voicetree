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
import { createContextNode } from '@/shell/edge/main/graph/context-nodes/createContextNode';
import { createContextNodeFromSelectedNodes } from '@/shell/edge/main/graph/context-nodes/createContextNodeFromSelectedNodes';
import { getGraph } from '@/shell/edge/main/state/graph-store';
import { loadSettings } from '@/shell/edge/main/settings/settings_IO';
import { uiAPI } from '@/shell/edge/main/ui-api-proxy';
import { createTerminalData, getTerminalId, type TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { NodeIdAndFilePath, GraphNode, Graph } from '@/pure/graph';
import { getNodeTitle } from '@/pure/graph/markdown-parsing';
import { findFirstParentNode } from '@/pure/graph/graph-operations/findFirstParentNode';
import type { VTSettings } from '@/pure/settings';
import { getNextAgentName, getUniqueAgentName } from '@/pure/settings/types';
import { getNextTerminalCountForNode, getExistingAgentNames } from '@/shell/edge/main/terminals/terminal-registry';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {getWatchStatus} from "@/shell/edge/main/graph/watch_folder/watchFolder";
import {buildTerminalEnvVars} from '@/shell/edge/main/terminals/buildTerminalEnvVars';

/**
 * Spawn a terminal with a context node, orchestrated from main process
 *
 * This function replaces the UI-side spawnTerminalWithNewContextNode,
 * eliminating the setTimeout hack by keeping all orchestration in the
 * main process where graph state is immediately available.
 *
 * @param taskNodeId - The task node to anchor terminal to (and create context for)
 * @param agentCommand - The agent command to run
 * @param terminalCount - Current terminal count from UI TerminalStore
 * @param skipFitAnimation - If true, skip navigating viewport to the terminal (used for MCP spawns)
 * @param startUnpinned - If true, terminal starts unpinned (used for MCP spawns)
 * @param selectedNodeIds - If provided, creates context from these nodes instead of subgraph
 * @param parentTerminalId - Parent terminal ID for tree-style tabs (used for MCP spawn_agent)
 */
export async function spawnTerminalWithContextNode(
    taskNodeId: NodeIdAndFilePath,
    agentCommand: string | undefined,
    terminalCount?: number,
    skipFitAnimation?: boolean,
    startUnpinned?: boolean,
    selectedNodeIds?: readonly NodeIdAndFilePath[],
    spawnDirectory?: string,
    parentTerminalId?: string,
    agentInstructions?: string
): Promise<{terminalId: string; contextNodeId: NodeIdAndFilePath}> {
    // Load settings to get agents
    const settings: VTSettings = await loadSettings();
    if (!settings) {
        throw new Error(`Failed to load settings for ${taskNodeId}`);
    }

    // Use provided command or default to first agent
    const agents: readonly { readonly name: string; readonly command: string }[] = settings.agents ?? [];

    // SECURITY: Validate that agentCommand (if provided) is from settings.agents
    // This prevents XSS attacks from executing arbitrary shell commands via IPC
    if (agentCommand !== undefined) {
        const validCommands: Set<string> = new Set(agents.map(a => a.command));
        const isValidCommand: boolean = validCommands.has(agentCommand);
        if (!isValidCommand) {
            console.error(`[SECURITY] Rejected unauthorized agent command: ${agentCommand.slice(0, 50)}...`);
            throw new Error('Invalid agent command - must be defined in settings.agents');
        }
    }

    const command: string = agentCommand ?? agents[0]?.command ?? '';
    if (!command) {
        throw new Error('No agent command available - settings.agents is empty or undefined');
    }

    // Get task node from graph
    const graph: Graph = getGraph();
    const taskNode: GraphNode = graph.nodes[taskNodeId];
    if (!taskNode) {
        throw new Error(`Node ${taskNodeId} not found in graph`);
    }

    // Create or reuse context node
    let contextNodeId: NodeIdAndFilePath;
    let resolvedTaskNodeId: NodeIdAndFilePath;
    if (taskNode.nodeUIMetadata.isContextNode) {
        // Passed a context node - reuse it and find the real task node
        contextNodeId = taskNodeId;
        const parentTaskNode: GraphNode | undefined = findFirstParentNode(taskNode, graph);
        resolvedTaskNodeId = parentTaskNode?.absoluteFilePathIsID ?? taskNodeId;
    } else {
        // Create context node for the task node
        contextNodeId = selectedNodeIds
            ? await createContextNodeFromSelectedNodes(taskNodeId, selectedNodeIds)
            : await createContextNode(taskNodeId, agentInstructions);
        resolvedTaskNodeId = taskNodeId;
    }

    // Prepare terminal data (main has immediate access to all state)
    const resolvedTerminalCount: number = typeof terminalCount === 'number'
        ? terminalCount
        : getNextTerminalCountForNode(contextNodeId)

    const terminalData: TerminalData = await prepareTerminalDataInMain(
        contextNodeId,
        resolvedTaskNodeId,
        resolvedTerminalCount,
        command,
        settings,
        startUnpinned,
        spawnDirectory,
        parentTerminalId
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
 * @param contextNodeId - The context node containing agent context (attachedToContextNodeId)
 * @param taskNodeId - The task node to anchor the terminal shadow to (anchoredToNodeId)
 * @param parentTerminalId - Parent terminal ID for tree-style tabs (used for MCP spawn_agent)
 */
async function prepareTerminalDataInMain(
    contextNodeId: NodeIdAndFilePath,
    taskNodeId: NodeIdAndFilePath,
    terminalCount: number,
    command: string,
    settings: VTSettings,
    startUnpinned?: boolean,
    spawnDirectory?: string,
    parentTerminalId?: string
): Promise<TerminalData> {
    // Get context node from graph (main has immediate access)
    const graph: Graph = getGraph();
    const contextNode: GraphNode = graph.nodes[contextNodeId];
    if (!contextNode) {
        throw new Error(`Context node ${contextNodeId} not found in graph`);
    }

    // Build terminal title from task node title (the node that spawned this terminal)
    // Context nodes are orphaned (no edges), so we use the taskNodeId directly
    const taskNode: GraphNode | undefined = graph.nodes[taskNodeId];
    const title: string = taskNode ? getNodeTitle(taskNode) : getNodeTitle(contextNode);

    // Generate unique agent name with collision handling (enables terminal-to-created-node edges)
    // terminalId now equals agentName for unified identification
    const baseAgentName: string = getNextAgentName();
    const existingNames: Set<string> = getExistingAgentNames();
    const agentName: string = getUniqueAgentName(baseAgentName, existingNames);

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

    // Override with explicit spawnDirectory if provided (e.g., for MCP spawns in worktrees)
    if (spawnDirectory) {
        initialSpawnDirectory = spawnDirectory;
    }

    // Task node path (parent of context node) - also absolute
    const taskNodeAbsolutePath: string = taskNode
        ? taskNode.absoluteFilePathIsID
        : '';

    // terminalId = agentName (unified identification)
    const terminalId: TerminalId = agentName as TerminalId;

    const expandedEnvVars: Record<string, string> = await buildTerminalEnvVars({
        contextNodePath: contextNodeId,
        taskNodePath: taskNodeAbsolutePath,
        terminalId: agentName,
        agentName,
        settings,
    });

    // Extract worktree name from spawnDirectory if spawning in a .worktrees/ directory
    const worktreeName: string | undefined = extractWorktreeNameFromPath(initialSpawnDirectory);

    // Create TerminalData using the factory function (flat type, no nested floatingWindow)
    // anchoredToNodeId = taskNodeId (shadow node connects to task node)
    // attachedToContextNodeId = contextNodeId (for metadata, env vars, and shadow→context edge)
    const terminalData: TerminalData = createTerminalData({
        terminalId: terminalId, // terminalId = agentName (unified)
        attachedToNodeId: contextNodeId,
        terminalCount: terminalCount,
        title: title,
        anchoredToNodeId: taskNodeId,
        initialCommand: command,
        executeCommand: true,
        initialSpawnDirectory: initialSpawnDirectory,
        initialEnvVars: expandedEnvVars,
        isPinned: !startUnpinned,
        agentName: agentName,
        parentTerminalId: parentTerminalId as TerminalId | null,
        worktreeName: worktreeName,
    });

    return terminalData;
}

/**
 * Extract worktree directory name from a spawn path, if it's inside a .worktrees/ directory.
 * Returns undefined if the path is not a worktree path.
 *
 * Example: "/repo/.worktrees/wt-fix-auth-bug-a3k" → "wt-fix-auth-bug-a3k"
 */
function extractWorktreeNameFromPath(spawnDirectory: string | undefined): string | undefined {
    if (!spawnDirectory) return undefined;
    const marker: string = '.worktrees/';
    const markerIndex: number = spawnDirectory.indexOf(marker);
    if (markerIndex === -1) return undefined;
    const afterMarker: string = spawnDirectory.slice(markerIndex + marker.length);
    // Take just the first path segment (the worktree directory name)
    const slashIndex: number = afterMarker.indexOf('/');
    const dirName: string = slashIndex === -1 ? afterMarker : afterMarker.slice(0, slashIndex);
    return dirName || undefined;
}
