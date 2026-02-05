/**
 * Spawns a plain terminal (no agent command, no context node).
 */

import path from 'path';
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@/pure/graph';
import type {Position} from '@/pure/graph';
import {createNewNodeNoParent} from '@/pure/graph/graphDelta/uiInteractionsToGraphDeltas';
import {getNodeTitle} from '@/pure/graph/markdown-parsing';
import {resolveEnvVars, expandEnvVarsInValues} from '@/pure/settings';
import type {VTSettings} from '@/pure/settings/types';
import {getNextAgentName, getUniqueAgentName} from '@/pure/settings/types';
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types';
import {getExistingAgentNames} from '@/shell/edge/main/terminals/terminal-registry';
import {getAppSupportPath} from '@/shell/edge/main/state/app-electron-state';
import {getGraph} from '@/shell/edge/main/state/graph-store';
import {getWatchStatus } from '@/shell/edge/main/graph/watch_folder/watchFolder';
import * as O from 'fp-ts/lib/Option.js';
import {loadSettings} from '@/shell/edge/main/settings/settings_IO';
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {getVaultPaths, getWritePath} from "@/shell/edge/main/graph/watch_folder/vault-allowlist";

export async function spawnPlainTerminal(nodeId: NodeIdAndFilePath, terminalCount: number): Promise<void> {
  // todo, tech debt. Most of this is duplicated with other terminal spawn paths.

  const settings: VTSettings = await loadSettings();
  const resolvedEnvVars: Record<string, string> = resolveEnvVars(settings.INJECT_ENV_VARS);

  const graph: Graph = getGraph();
  const node: GraphNode | undefined = graph.nodes[nodeId];
  const title: string = node ? getNodeTitle(node) : 'Terminal';

  const watchStatus: { readonly isWatching: boolean; readonly directory: string | undefined } = getWatchStatus();
  let initialSpawnDirectory: string | undefined = watchStatus.directory;

  if (watchStatus?.directory && settings.terminalSpawnPathRelativeToWatchedDirectory) {
    const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
    initialSpawnDirectory = path.join(watchStatus.directory, relativePath);
  }

  const appSupportPath: string = getAppSupportPath();
  // Node IDs are now absolute paths - use directly
  const nodeAbsolutePath: string = nodeId;

  // Get all vault paths for ALL_MARKDOWN_READ_PATHS
  const allVaultPaths: readonly string[] = await getVaultPaths();
  const allMarkdownReadPaths: string = allVaultPaths.join('\n');

  // Get vault path for VOICETREE_VAULT_PATH
  const vaultPath: string = O.getOrElse(() => '')(await getWritePath());

  // Generate unique agent name with collision handling for terminal identification
  // Plain terminals still need unique IDs for registry tracking
  const baseAgentName: string = getNextAgentName();
  const existingNames: Set<string> = getExistingAgentNames();
  const agentName: string = getUniqueAgentName(baseAgentName, existingNames);
  // terminalId = agentName (unified identification)
  const terminalId: TerminalId = agentName as TerminalId;

  const unexpandedEnvVars: Record<string, string> = {
    VOICETREE_APP_SUPPORT: appSupportPath ?? '',
    VOICETREE_VAULT_PATH: vaultPath,
    ALL_MARKDOWN_READ_PATHS: allMarkdownReadPaths,
    CONTEXT_NODE_PATH: nodeAbsolutePath,
    TASK_NODE_PATH: nodeAbsolutePath,
    VOICETREE_TERMINAL_ID: agentName, // Same as AGENT_NAME
    AGENT_NAME: agentName,
    ...resolvedEnvVars,
  };
  const expandedEnvVars: Record<string, string> = expandEnvVarsInValues(unexpandedEnvVars);

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
