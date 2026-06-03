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

import { loadSettings } from '@vt/app-config/settings';
import {type TerminalId } from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts';
import type { NodeIdAndFilePath, GraphNode, Graph } from '@vt/graph-model/graph';
import { findFirstParentNode } from '@vt/graph-model/graph';
import type { VTSettings } from '@vt/graph-model/settings';
import { uniqueAgentName, pickAgentName } from '@vt/graph-model/settings';
import { getNextTerminalCountForNode, getExistingAgentNames, recordTerminalPending } from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/index.ts';
import {
    getRuntimeGraph,
    runtimeCreateContextNode,
    runtimeCreateContextNodeFromSelectedNodes,
} from '../runtime/graph-bridge';
import {launchTerminalSpawn} from './launchTerminalSpawn';
import {resolveAgentCommand} from './agentCommand';
import {
    defaultSpawnTerminalDeps,
    type SpawnTerminalDeps,
} from './reloadNodeFromDisk';

export {buildHeadlessCommand, detectCliType} from './cli/headlessCli';

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
    deps: SpawnTerminalDeps = defaultSpawnTerminalDeps,
): Promise<{terminalId: string; contextNodeId: NodeIdAndFilePath}> {
    // Normalize: strip trailing slashes from node IDs (directories are not valid nodes)
    const normalizedNodeId: NodeIdAndFilePath = taskNodeId.endsWith('/') ? taskNodeId.slice(0, -1) as NodeIdAndFilePath : taskNodeId;
    taskNodeId = normalizedNodeId;

    // Load settings to get agents
    const settings: VTSettings = await loadSettings();
    const command: string = resolveAgentCommand(agentCommand, settings, taskNodeId);

    // Read through the runtime graph bridge; the daemon watcher owns disk-to-graph synchronization.
    const graph: Graph = await getRuntimeGraph();
    const taskNode: GraphNode | undefined = graph.nodes[taskNodeId];
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
            ? await runtimeCreateContextNodeFromSelectedNodes(taskNodeId, selectedNodeIds)
            : await runtimeCreateContextNode(taskNodeId);
        resolvedTaskNodeId = taskNodeId;
    }

    // Compute the eventual terminalId / agentName eagerly so we can return to the
    // caller before the heavy terminal-prep work finishes. getExistingAgentNames
    // includes pending entries, so concurrent spawns won't collide.
    const agentName: string = inheritTerminalId ?? (() => {
        const baseAgentName: string = pickAgentName(settings);
        const existingNames: Set<string> = getExistingAgentNames();
        return uniqueAgentName(baseAgentName, existingNames);
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
    void launchTerminalSpawn({
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
        agentName,
        terminalId,
        skipFitAnimation,
        logger: deps.logger,
    })

    return {
        terminalId: terminalId,
        contextNodeId
    }
}
