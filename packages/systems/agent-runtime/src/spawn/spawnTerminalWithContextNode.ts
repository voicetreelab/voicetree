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
 * 3. Main process calls UI via runtime UI bridge launchTerminalOntoUI()
 * 4. UI renders terminal with Cytoscape
 *
 * Note: Permission mode prompting is now handled in the renderer
 * (spawnTerminalWithCommandFromUI.ts) before calling this function.
 */

import path from 'path';
import { promises as fs } from 'fs';
import { loadSettings } from '@vt/app-config/settings';
import { createTerminalData, getTerminalId, type TerminalId } from '../types';
import type { NodeIdAndFilePath, GraphNode, Graph, FSUpdate, GraphDelta } from '@vt/graph-model/graph';
import { applyGraphDeltaToGraph } from '@vt/graph-model/graph';
import { getNodeTitle } from '@vt/graph-model/markdown';
import { findFirstParentNode } from '@vt/graph-model/graph';
import type { VTSettings } from '@vt/graph-model/settings';
import { getNextAgentName, getUniqueAgentName, getDefaultAgent } from '@vt/graph-model/settings';
import { getNextTerminalCountForNode, getExistingAgentNames, recordTerminalPending, clearPendingTerminal } from '../terminals/terminal-registry';
import { setTerminalBudget } from '../terminals/global-budget-registry';
import type {TerminalData} from '../types';
import {buildTerminalEnvVars} from './buildTerminalEnvVars';
import {spawnHeadlessAgent, killHeadlessAgent} from '../headless/headlessAgentManager';
import {addNodeToGraphWithEdgeHealingFromFSEvent} from '@vt/graph-model/graph';
import {getRuntimeUI} from '../runtime-config';
import {graphDbContextNodes, graphDbPersistence, graphDbState, graphDbWatch} from '../graph-db-boundary';

type SpawnTerminalLogger = {
    error(message?: unknown, ...optionalParams: unknown[]): void
    warn(message?: unknown, ...optionalParams: unknown[]): void
}

type SpawnTerminalDeps = {
    readTextFile(filePath: string): Promise<string>
    logger: SpawnTerminalLogger
}

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
    envOverrides?: Record<string, string>,
    deps: SpawnTerminalDeps = {
        readTextFile: (filePath: string): Promise<string> => fs.readFile(filePath, 'utf-8'),
        logger: { error: console.error, warn: console.warn },
    },
): Promise<{terminalId: string; contextNodeId: NodeIdAndFilePath}> {
    // Normalize: strip trailing slashes from node IDs (directories are not valid nodes)
    const normalizedNodeId: NodeIdAndFilePath = taskNodeId.endsWith('/') ? taskNodeId.slice(0, -1) as NodeIdAndFilePath : taskNodeId;
    taskNodeId = normalizedNodeId;

    // Load settings to get agents
    const settings: VTSettings = await loadSettings();
    if (!settings) {
        throw new Error(`Failed to load settings for ${taskNodeId}`);
    }

    // Use provided command or default agent from settings
    const agents: readonly { readonly name: string; readonly command: string }[] = settings.agents ?? [];

    // SECURITY: Validate that agentCommand (if provided) is from settings.agents
    // This prevents XSS attacks from executing arbitrary shell commands via IPC
    if (agentCommand !== undefined) {
        const validCommands: Set<string> = new Set(agents.map(a => a.command));
        const isValidCommand: boolean = validCommands.has(agentCommand);
        if (!isValidCommand) {
            throw new Error('Invalid agent command - must be defined in settings.agents');
        }
    }

    const command: string = agentCommand ?? getDefaultAgent(agents, settings.defaultAgent)?.command ?? '';
    if (!command) {
        throw new Error('No agent command available - settings.agents is empty or undefined');
    }

    // Get task node from graph (self-heal if file exists on disk but missing from graph)
    let graph: Graph = graphDbState.getGraph();
    let taskNode: GraphNode | undefined = graph.nodes[taskNodeId];
    if (!taskNode) {
        taskNode = await tryReloadNodeFromDisk(taskNodeId, {
            readTextFile: deps.readTextFile,
            logger: deps.logger,
        });
        if (!taskNode) {
            throw new Error(`Node ${taskNodeId} not found in graph or on disk`);
        }
        graph = graphDbState.getGraph(); // re-read after self-heal mutated graph store
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
            ? await graphDbContextNodes.createContextNodeFromSelectedNodes(taskNodeId, selectedNodeIds)
            : await graphDbContextNodes.createContextNode(taskNodeId);
        resolvedTaskNodeId = taskNodeId;
    }

    // Compute the eventual terminalId / agentName eagerly so we can return to the
    // caller before the heavy terminal-prep work finishes. getExistingAgentNames
    // includes pending entries, so concurrent spawns won't collide.
    const agentName: string = inheritTerminalId ?? (() => {
        const baseAgentName: string = getNextAgentName();
        const existingNames: Set<string> = getExistingAgentNames();
        return getUniqueAgentName(baseAgentName, existingNames);
    })();
    const terminalId: TerminalId = agentName as TerminalId;

    const resolvedTerminalCount: number = typeof terminalCount === 'number'
        ? terminalCount
        : getNextTerminalCountForNode(contextNodeId)

    // Reserve the terminalId in the registry so MCP tools (send_message,
    // read_terminal_output, list_agents completion monitor) can do the right
    // thing while the rest of the spawn runs async.
    recordTerminalPending(terminalId, !!headless)

    // Fire-and-forget: prepareTerminalDataInMain + spawn launch + bookkeeping.
    // None of these produce values the caller needs in the response, so they
    // can run after we've returned terminalId + contextNodeId.
    void (async (): Promise<void> => {
        try {
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
                envOverrides,
                agentName
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
                    getRuntimeUI().closeTerminalById?.(inheritTerminalId)
                }

                // Call UI to launch terminal via the runtime UI bridge.
                // Bridge is fire-and-forget (e.g. webapp sends IPC, headless no-op).
                getRuntimeUI().launchTerminalOntoUI?.(contextNodeId, terminalData, skipFitAnimation);
            }

            if (parentTerminalId) {
                getRuntimeUI().registerChildIfMonitored?.(parentTerminalId, getTerminalId(terminalData))
            }

            // Set spawn budget for this terminal from GLOBAL_SPAWN_BUDGET env var
            // Root terminals read from env; child terminals receive their budget via envOverrides from spawnAgentTool
            if (terminalData.initialEnvVars?.GLOBAL_SPAWN_BUDGET) {
                const budget: number = parseInt(terminalData.initialEnvVars.GLOBAL_SPAWN_BUDGET, 10);
                if (!isNaN(budget) && budget >= 0) {
                    setTerminalBudget(terminalId, budget);
                }
            }
        } catch (err) {
            // Spawn prep failed after the MCP response already returned success.
            // Drop the pending entry so follow-up tool calls correctly report
            // "Terminal not found" rather than queueing forever.
            clearPendingTerminal(terminalId)
            deps.logger.error(`[spawnTerminalWithContextNode] async spawn failed for ${terminalId}:`, err)
        }
    })()

    return {
        terminalId: terminalId,
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
    envOverrides?: Record<string, string>,
    precomputedAgentName?: string
): Promise<TerminalData> {
    // Get context node from graph (main has immediate access)
    const graph: Graph = graphDbState.getGraph();
    const contextNode: GraphNode = graph.nodes[contextNodeId];
    if (!contextNode) {
        throw new Error(`Context node ${contextNodeId} not found in graph`);
    }

    // Build terminal title from task node title (the node that spawned this terminal)
    // Context nodes are orphaned (no edges), so we use the taskNodeId directly
    const taskNode: GraphNode | undefined = graph.nodes[taskNodeId];
    const title: string = taskNode ? getNodeTitle(taskNode) : getNodeTitle(contextNode);

    // Generate unique agent name with collision handling (enables terminal-to-created-node edges)
    // terminalId now equals agentName for unified identification.
    // Callers (e.g. spawnTerminalWithContextNode) may pre-compute the agentName so they
    // can reserve it in the registry before calling this; honour their value to avoid drift.
    // When inheritTerminalId is set (replaceSelf), reuse the caller's identity.
    const agentName: string = precomputedAgentName ?? inheritTerminalId ?? (() => {
        const baseAgentName: string = getNextAgentName();
        const existingNames: Set<string> = getExistingAgentNames();
        return getUniqueAgentName(baseAgentName, existingNames);
    })();

    // Compute initial_spawn_directory from watch directory + relative path setting
    let initialSpawnDirectory: string | undefined;
    const watchStatus: {
        readonly isWatching: boolean;
        readonly directory: string | undefined;
    } = graphDbWatch.getWatchStatus();

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
async function tryReloadNodeFromDisk(
    nodeId: NodeIdAndFilePath,
    deps: Pick<SpawnTerminalDeps, 'readTextFile' | 'logger'> = {
        readTextFile: (filePath: string): Promise<string> => fs.readFile(filePath, 'utf-8'),
        logger: { error: console.error, warn: console.warn },
    },
): Promise<GraphNode | undefined> {
    const filePath: string = nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`
    try {
        const content: string = await deps.readTextFile(filePath)
        const fsEvent: FSUpdate = { absolutePath: filePath, content, eventType: 'Added' }
        const graph: Graph = graphDbState.getGraph()
        const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, graph)
        if (delta.length === 0) return undefined
        const newGraph: Graph = applyGraphDeltaToGraph(graph, delta)
        graphDbState.setGraph(newGraph)
        graphDbPersistence.refreshGraphChangeSideEffects()
        deps.logger.warn(`[spawnTerminal] Self-healed missing node from disk: ${nodeId}`)
        return newGraph.nodes[nodeId]
    } catch {
        return undefined
    }
}
