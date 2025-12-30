/**
 * Spawns a plain terminal (no agent command, no context node).
 */

import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@/pure/graph';
import type {Position} from '@/pure/graph';
import {createNewNodeNoParent} from '@/pure/graph/graphDelta/uiInteractionsToGraphDeltas';
import {getNodeTitle} from '@/pure/graph/markdown-parsing';
import {resolveEnvVars, expandEnvVarsInValues} from '@/pure/settings';
import type {VTSettings} from '@/pure/settings/types';
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/types';
import {createTerminalData} from '@/shell/edge/UI-edge/floating-windows/types';
import {getAppSupportPath} from '@/shell/edge/main/state/app-electron-state';
import {getGraph} from '@/shell/edge/main/state/graph-store';
import {getWatchStatus, getWatchedDirectory} from '@/shell/edge/main/graph/watchFolder';
import {loadSettings} from '@/shell/edge/main/settings/settings_IO';
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange';

export async function spawnPlainTerminal(nodeId: NodeIdAndFilePath, terminalCount: number): Promise<void> {
  const settings: VTSettings = await loadSettings();
  const resolvedEnvVars: Record<string, string> = resolveEnvVars(settings.INJECT_ENV_VARS);

  const graph: Graph = getGraph();
  const node: GraphNode | undefined = graph.nodes[nodeId];
  const title: string = node ? getNodeTitle(node) : 'Terminal';

  const watchStatus: { readonly isWatching: boolean; readonly directory: string | undefined } = getWatchStatus();
  let initialSpawnDirectory: string | undefined = watchStatus.directory;

  if (watchStatus?.directory && settings.terminalSpawnPathRelativeToWatchedDirectory) {
    const baseDir: string = watchStatus.directory.replace(/\/$/, '');
    const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
    initialSpawnDirectory = `${baseDir}/${relativePath}`;
  }

  const appSupportPath: string = getAppSupportPath();
  const watchedDir: string | null = getWatchedDirectory();
  const nodeAbsolutePath: string = watchedDir
    ? `${watchedDir.replace(/\/$/, '')}/${nodeId}`
    : nodeId;

  const unexpandedEnvVars: Record<string, string> = {
    VOICETREE_APP_SUPPORT: appSupportPath ?? '',
    CONTEXT_NODE_PATH: nodeAbsolutePath,
    ...resolvedEnvVars,
  };
  const expandedEnvVars: Record<string, string> = expandEnvVarsInValues(unexpandedEnvVars);

  const terminalData: TerminalData = createTerminalData({
    attachedToNodeId: nodeId,
    terminalCount: terminalCount,
    title: title,
    anchoredToNodeId: nodeId,
    // No initialCommand - opens a plain shell
    executeCommand: false,
    initialSpawnDirectory: initialSpawnDirectory,
    initialEnvVars: expandedEnvVars,
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
    // Get vault suffix so node ID includes correct path prefix
    const vaultSuffix: string = getWatchStatus().vaultSuffix;
    const graph: Graph = getGraph();

    // Create a new orphan node (same as 'Add Node Here')
    const {newNode, graphDelta}: {readonly newNode: GraphNode; readonly graphDelta: GraphDelta} =
        createNewNodeNoParent(position, vaultSuffix, graph);

    // Persist the node to disk and update UI
    await applyGraphDeltaToDBThroughMemAndUIAndEditors(graphDelta);

    // Now spawn a plain terminal attached to this node
    await spawnPlainTerminal(newNode.relativeFilePathIsID, terminalCount);
}
