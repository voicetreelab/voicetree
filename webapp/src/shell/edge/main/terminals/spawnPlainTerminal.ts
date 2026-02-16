/**
 * Spawns a plain terminal (no agent command, no context node).
 */

import path from 'path';
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@/pure/graph';
import type {Position} from '@/pure/graph';
import {createNewNodeNoParent} from '@/pure/graph/graphDelta/uiInteractionsToGraphDeltas';
import {getNodeTitle} from '@/pure/graph/markdown-parsing';
import type {VTSettings} from '@/pure/settings/types';
import {getNextAgentName, getUniqueAgentName} from '@/pure/settings/types';
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types';
import {getExistingAgentNames} from '@/shell/edge/main/terminals/terminal-registry';
import {getGraph} from '@/shell/edge/main/state/graph-store';
import {getWatchStatus} from '@/shell/edge/main/graph/watch_folder/watchFolder';
import * as O from 'fp-ts/lib/Option.js';
import {loadSettings} from '@/shell/edge/main/settings/settings_IO';
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {getWritePath} from "@/shell/edge/main/graph/watch_folder/vault-allowlist";
import {buildTerminalEnvVars} from '@/shell/edge/main/terminals/buildTerminalEnvVars';

export async function spawnPlainTerminal(nodeId: NodeIdAndFilePath, terminalCount: number): Promise<void> {
  const settings: VTSettings = await loadSettings();

  const graph: Graph = getGraph();
  const node: GraphNode | undefined = graph.nodes[nodeId];
  const title: string = node ? getNodeTitle(node) : 'Terminal';

  const watchStatus: { readonly isWatching: boolean; readonly directory: string | undefined } = getWatchStatus();
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

  void uiAPI.launchTerminalOntoUI(nodeId, terminalData);
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
    const writePathOption: O.Option<string> = await getWritePath();
    const writePath: string = O.getOrElse(() => '')(writePathOption);
    const graph: Graph = getGraph();

    // Create a new orphan node (same as 'Add Node Here')
    const {newNode, graphDelta}: {readonly newNode: GraphNode; readonly graphDelta: GraphDelta} =
        createNewNodeNoParent(position, writePath, graph);

    // Persist the node to disk and update UI
    await applyGraphDeltaToDBThroughMemAndUIAndEditors(graphDelta);

    // Now spawn a plain terminal attached to this node
    await spawnPlainTerminal(newNode.absoluteFilePathIsID, terminalCount);
}
