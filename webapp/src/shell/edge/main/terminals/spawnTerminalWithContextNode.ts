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
import { promises as fs } from 'fs';
import { createContextNode } from '@/shell/edge/main/graph/context-nodes/createContextNode';
import { createContextNodeFromSelectedNodes } from '@/shell/edge/main/graph/context-nodes/createContextNodeFromSelectedNodes';
import { getGraph, setGraph } from '@/shell/edge/main/state/graph-store';
import { loadSettings } from '@/shell/edge/main/settings/settings_IO';
import { uiAPI } from '@/shell/edge/main/ui-api-proxy';
import { createTerminalData, getTerminalId, type TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { NodeIdAndFilePath, GraphNode, Graph, FSUpdate, GraphDelta } from '@/pure/graph';
import { applyGraphDeltaToGraph } from '@/pure/graph';
import { getNodeTitle } from '@/pure/graph/markdown-parsing';
import { findFirstParentNode } from '@/pure/graph/graph-operations/findFirstParentNode';
import type { VTSettings } from '@/pure/settings';
import { getNextAgentName, getUniqueAgentName } from '@/pure/settings/types';
import { getNextTerminalCountForNode, getExistingAgentNames } from '@/shell/edge/main/terminals/terminal-registry';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {getWatchStatus} from "@/shell/edge/main/graph/watch_folder/watchFolder";
import {buildTerminalEnvVars} from '@/shell/edge/main/terminals/buildTerminalEnvVars';
import {spawnHeadlessAgent, killHeadlessAgent} from '@/shell/edge/main/terminals/headlessAgentManager';
import {registerChildIfMonitored} from '@/shell/edge/main/mcp-server/agent-completion-monitor';
import {addNodeToGraphWithEdgeHealingFromFSEvent} from '@/pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent';
import {broadcastGraphDeltaToUI} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI';

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
    promptTemplate?: string,
    headless?: boolean,
    inheritTerminalId?: string,
    envOverrides?: Record<string, string>
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

    // Get task node from graph (self-heal if file exists on disk but missing from graph)
    let graph: Graph = getGraph();
    let taskNode: GraphNode | undefined = graph.nodes[taskNodeId];
    if (!taskNode) {
        taskNode = await tryReloadNodeFromDisk(taskNodeId);
        if (!taskNode) {
            throw new Error(`Node ${taskNodeId} not found in graph or on disk`);
        }
        graph = getGraph(); // re-read after self-heal mutated graph store
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
            : await createContextNode(taskNodeId);
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
        parentTerminalId,
        promptTemplate,
        headless,
        inheritTerminalId,
        envOverrides
    );

    if (headless) {
        // Headless branch: spawn as background child_process, no PTY/xterm.js
        const headlessCommand: string = buildHeadlessCommand(command)
        const headlessEnv: Record<string, string> = terminalData.initialEnvVars ?? {}

        // replaceSelf: kill old process before spawning successor with same ID
        if (inheritTerminalId) {
            killHeadlessAgent(inheritTerminalId as TerminalId)
        }

        spawnHeadlessAgent(
            getTerminalId(terminalData),
            terminalData,
            headlessCommand,
            terminalData.initialSpawnDirectory,
            headlessEnv
        )
    } else {
        // Interactive branch: launch terminal onto UI with xterm.js

        // replaceSelf for interactive: close the old terminal first
        if (inheritTerminalId) {
            uiAPI.closeTerminalById(inheritTerminalId)
        }

        // Call UI to launch terminal (via UI API pattern)
        // Note: uiAPI sends IPC message, no need to await (fire-and-forget)
        void uiAPI.launchTerminalOntoUI(contextNodeId, terminalData, skipFitAnimation);
    }

    if (parentTerminalId) {
        registerChildIfMonitored(parentTerminalId, getTerminalId(terminalData))
    }

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
    parentTerminalId?: string,
    promptTemplate?: string,
    headless?: boolean,
    inheritTerminalId?: string,
    envOverrides?: Record<string, string>
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
    // When inheritTerminalId is set (replaceSelf), reuse the caller's identity
    const agentName: string = inheritTerminalId ?? (() => {
        const baseAgentName: string = getNextAgentName();
        const existingNames: Set<string> = getExistingAgentNames();
        return getUniqueAgentName(baseAgentName, existingNames);
    })();

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
        promptTemplate,
        envOverrides,
    });

    // Extract worktree name from spawnDirectory if spawning in a .worktrees/ directory
    const worktreeName: string | undefined = extractWorktreeNameFromPath(initialSpawnDirectory);

    // Read context content for the dropdown panel
    const contextContent: string = contextNode.contentWithoutYamlOrLinks;

    // Resolve human-readable agent type name from settings by matching command
    const agentTypeName: string = settings.agents.find(a => a.command === command)?.name ?? '';

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
        isHeadless: headless,
        contextContent: contextContent,
        agentTypeName: agentTypeName,
    });

    return terminalData;
}

/**
 * Detect CLI type from the agent command string.
 * Used for CLI-specific headless command construction and stop gate resume.
 */
export function detectCliType(command: string): 'claude' | 'codex' | 'gemini' | null {
    if (command.startsWith('claude ') || command === 'claude') return 'claude'
    if (command.startsWith('codex ') || command === 'codex') return 'codex'
    if (command.startsWith('gemini ') || command === 'gemini') return 'gemini'
    return null
}

/**
 * Build the shell command for a headless agent from the interactive agent command.
 * Strips the interactive "$AGENT_PROMPT" positional arg, then re-adds per CLI convention.
 * No --session-id flag — CLI auto-generates one; resume uses --continue.
 */
export function buildHeadlessCommand(command: string): string {
    const baseCommand: string = command.replace('"$AGENT_PROMPT"', '').replace("'$AGENT_PROMPT'", '').trim()
    const cliType: 'claude' | 'codex' | 'gemini' | null = detectCliType(baseCommand)
    // Codex headless: `codex exec --full-auto "$AGENT_PROMPT"` (positional prompt, no TTY needed)
    if (cliType === 'codex') return `codex exec --full-auto "$AGENT_PROMPT"`
    const promptArg: string = ' -p "$AGENT_PROMPT"'
    return `${baseCommand}${promptArg}`
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

/**
 * Self-healing: attempt to load a node from disk when it exists as a file
 * but is missing from the in-memory graph.
 *
 * This handles edge cases where the graph state gets out of sync with the
 * filesystem (race conditions during loading, skipped watcher events, etc.).
 *
 * Returns the loaded GraphNode, or undefined if the file doesn't exist.
 */
async function tryReloadNodeFromDisk(nodeId: NodeIdAndFilePath): Promise<GraphNode | undefined> {
    const filePath: string = nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`
    try {
        const content: string = await fs.readFile(filePath, 'utf-8')
        const fsEvent: FSUpdate = { absolutePath: filePath, content, eventType: 'Added' }
        const graph: Graph = getGraph()
        const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, graph)
        if (delta.length === 0) return undefined
        const newGraph: Graph = applyGraphDeltaToGraph(graph, delta)
        setGraph(newGraph)
        broadcastGraphDeltaToUI(delta)
        console.warn(`[spawnTerminal] Self-healed missing node from disk: ${nodeId}`)
        return newGraph.nodes[nodeId]
    } catch {
        return undefined
    }
}
