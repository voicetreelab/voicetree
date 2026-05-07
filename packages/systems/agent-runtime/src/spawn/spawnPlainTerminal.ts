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
import {createTerminalData, type TerminalId} from '../types';
import {getExistingAgentNames} from '../terminals/terminal-registry';
import {getWatchStatus} from '@vt/graph-db-client';
import {loadSettings} from '@vt/app-config/settings';
import type {TerminalData} from '../types';
import {buildTerminalEnvVars} from './buildTerminalEnvVars';
import {getRuntimeGraphDbClient, getRuntimeUI} from '../runtime-config';

export async function spawnPlainTerminal(nodeId: NodeIdAndFilePath, terminalCount: number): Promise<void> {
  const settings: VTSettings = await loadSettings();
  const client = getRuntimeGraphDbClient();

  const graph: Graph = await client.getGraph() as unknown as Graph;
  const node: GraphNode | undefined = graph.nodes[nodeId];
  const title: string = node ? getNodeTitle(node) : 'Terminal';

  const watchStatus: { readonly isWatching: boolean; readonly directory?: string } =
      await getWatchStatus(client.baseUrl);
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

  getRuntimeUI().launchTerminalOntoUI?.(nodeId, terminalData);
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
    const client = getRuntimeGraphDbClient();
    const writePath: string = (await client.getVault()).writePath;
    const graph: Graph = await client.getGraph() as unknown as Graph;

    // Create a new orphan node (same as 'Add Node Here')
    const {newNode, graphDelta}: {readonly newNode: GraphNode; readonly graphDelta: GraphDelta} =
        createNewNodeNoParent(position, writePath, graph);

    // Persist the node to disk and update UI
    await client.postDelta([...graphDelta]);

    // Now spawn a plain terminal attached to this node
    await spawnPlainTerminal(newNode.absoluteFilePathIsID, terminalCount);
}
