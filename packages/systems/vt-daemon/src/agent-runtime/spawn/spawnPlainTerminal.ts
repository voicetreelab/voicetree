/**
 * Spawns a plain terminal (no agent command, no context node).
 */

import path from 'path';
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph';
import type {Position} from '@vt/graph-model/graph';
import {createNewNodeNoParent} from '@vt/graph-model/graph';
import {getNodeTitle} from '@vt/graph-model/markdown';
import type {VTSettings} from '@vt/graph-model/settings';
import {getNextAgentName, getUniqueAgentName} from '@vt/graph-model/settings';
import {createTerminalData, type TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts';
import {getExistingAgentNames} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/index.ts';
import {getTerminalManager} from '@vt/vt-daemon/agent-runtime/terminals/manager/terminal-manager-instance.ts';
import {getRuntimeEnv} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts';
import type {TerminalSpawnResult} from '@vt/vt-daemon-protocol';
import * as O from 'fp-ts/lib/Option.js';
import {loadSettings} from '@vt/app-config/settings';
import type {TerminalData} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts';
import {buildTerminalEnvVars} from './buildTerminalEnvVars';
import {applyRuntimeGraphDelta, getRuntimeGraph, getRuntimeWatchStatus, getRuntimeWriteFolderPath} from '../runtime/graph-bridge';
import {publishTerminalRegistryEvent} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/terminal-registry-publisher.ts';

export async function spawnPlainTerminal(nodeId: NodeIdAndFilePath, terminalCount: number): Promise<void> {
  const settings: VTSettings = await loadSettings();

  const graph: Graph = await getRuntimeGraph();
  const node: GraphNode | undefined = graph.nodes[nodeId];
  const title: string = node ? getNodeTitle(node) : 'Terminal';

  const watchStatus: { readonly isWatching: boolean; readonly directory: string | undefined } = await getRuntimeWatchStatus();
  let initialSpawnDirectory: string | undefined = watchStatus.directory;

  if (watchStatus?.directory && settings.terminalSpawnPathRelativeToWatchedDirectory) {
    const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
    initialSpawnDirectory = path.join(watchStatus.directory, relativePath);
  }

  // Generate unique agent name with collision handling for terminal identification
  // Plain terminals still need unique IDs for registry tracking
  const baseAgentName: string = getNextAgentName();
  const existingNames: Set<string> = getExistingAgentNames();
  const agentName: string = getUniqueAgentName(baseAgentName, existingNames);
  // terminalId = agentName (unified identification)
  const terminalId: TerminalId = agentName as TerminalId;

  const expandedEnvVars: Record<string, string> = await buildTerminalEnvVars({
    contextNodePath: nodeId,
    taskNodePath: nodeId,
    terminalId: agentName,
    agentName,
    settings,
  });

  const terminalData: TerminalData = createTerminalData({
    terminalId: terminalId, // terminalId = agentName (unified)
    attachedToNodeId: nodeId,
    terminalCount: terminalCount,
    title: title,
    anchoredToNodeId: nodeId,
    // No initialCommand - opens a plain shell
    executeCommand: false,
    initialSpawnDirectory: initialSpawnDirectory,
    initialEnvVars: expandedEnvVars,
    agentName: agentName,
  });

  // The renderer's xterm attaches via WebSocket to /terminals/:id/attach, which
  // expects an EXISTING tmux session — the relay does not create one. Create
  // the tmux session here BEFORE publishing terminal-ui-launch so the WS
  // attach lands on a live session. Symmetrical with launchPreparedTerminal()
  // on the spawnTerminalWithContextNode path.
  const spawnResult: TerminalSpawnResult = await getTerminalManager().spawnTmuxBacked({
    terminalData,
    getToolsDirectory: () => getRuntimeEnv().getVtBinDir?.() ?? '',
    onData: () => {},
    onExit: () => {},
  });
  if (!spawnResult.success) {
    throw new Error(`Failed to spawn tmux session for ${spawnResult.terminalId}: ${spawnResult.error}`);
  }

  publishTerminalRegistryEvent({
    type: 'terminal-ui-launch',
    nodeId,
    terminalData,
    skipFitAnimation: false,
  });
}

/**
 * Spawns a plain terminal with a newly created markdown node attached.
 * The node enables draggability and note-saving for the terminal.
 *
 * Same logic as 'Add Node Here' but also attaches a plain terminal.
 */
export async function spawnPlainTerminalWithNode(
    position: Position,
    terminalCount: number
): Promise<void> {
    // Get write path (absolute) for new node creation
    const writeFolderPathOption: O.Option<string> = await getRuntimeWriteFolderPath();
    const writeFolderPath: string = O.getOrElse(() => '')(writeFolderPathOption);
    const graph: Graph = await getRuntimeGraph();

    // Create a new orphan node (same as 'Add Node Here')
    const {newNode, graphDelta}: {readonly newNode: GraphNode; readonly graphDelta: GraphDelta} =
        createNewNodeNoParent(position, writeFolderPath, graph);

    // Persist the node to disk and update UI
    await applyRuntimeGraphDelta(graphDelta);

    // Now spawn a plain terminal attached to this node
    await spawnPlainTerminal(newNode.absoluteFilePathIsID, terminalCount);
}
