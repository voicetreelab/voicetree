/**
 * Creates a context node from a question and spawns a terminal with the agent command.
 */

import path from 'path';
import * as O from 'fp-ts/lib/Option.js';
import type {Graph, GraphNode, NodeIdAndFilePath} from '@/pure/graph';
import {getNodeTitle} from '@/pure/graph/markdown-parsing';
import {findFirstParentNode} from '@/pure/graph/graph-operations/findFirstParentNode';
import {resolveEnvVars, expandEnvVarsInValues} from '@/pure/settings';
import type {VTSettings} from '@/pure/settings/types';
import {getNextAgentName} from '@/pure/settings/types';
import {createTerminalData} from '@/shell/edge/UI-edge/floating-windows/types';
import {getAppSupportPath} from '@/shell/edge/main/state/app-electron-state';
import {getGraph} from '@/shell/edge/main/state/graph-store';
import {loadSettings} from '@/shell/edge/main/settings/settings_IO';
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';
import {createContextNodeFromQuestion} from '@/shell/edge/main/graph/context-nodes/createContextNodeFromQuestion';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {getWritePath} from "@/shell/edge/main/graph/watch_folder/vault-allowlist";
import {getProjectRootWatchedDirectory} from "@/shell/edge/main/state/watch-folder-store";

export async function askModeCreateAndSpawn(relevantNodeIds: readonly string[], question: string): Promise<void> {
  // Get graph - node IDs are now absolute paths that match graph keys directly
  const graph: Graph = getGraph();
  const watchedDir: string | null = getProjectRootWatchedDirectory();

  // Use writePath for normalizing search results - this matches what the backend loads from
  // (see watchFolder.ts:316 where notifyTextToTreeServerOfDirectory uses config.writePath)
  const writePathOption: O.Option<string> = await getWritePath();
  const basePath: string | null = O.isSome(writePathOption)
    ? writePathOption.value
    : watchedDir;

  // Normalize incoming node IDs to absolute paths
  // Backend returns relative paths like "voice/note.md" but graph uses absolute paths
  const normalizedNodeIds: readonly string[] = relevantNodeIds.map(id => {
    if (path.isAbsolute(id)) return id;
    return basePath ? path.join(basePath, id) : id;
  });

  // Filter to only node IDs that exist in the graph
  const adjustedNodeIds: readonly string[] = normalizedNodeIds
    .filter(id => graph.nodes[id] !== undefined);

  // 1. Create context node from relevant nodes
  const contextNodeId: NodeIdAndFilePath = await createContextNodeFromQuestion(adjustedNodeIds, question);

  // 2. Get fresh graph - createContextNodeFromQuestion updates the graph store
  const updatedGraph: Graph = getGraph();

  // 3. Get terminal count from UI (we'll use 0 as default since we don't track it here)
  const terminalCount: number = 0;

  // 4. Load settings
  const settings: VTSettings = await loadSettings();
  const agents: readonly { readonly name: string; readonly command: string }[] = settings.agents ?? [];
  const command: string = agents[0]?.command ?? '';

  if (!command) {
    throw new Error('No agent command available');
  }

  // 5. Prepare terminal data
  const contextNode: GraphNode = updatedGraph.nodes[contextNodeId];
  if (!contextNode) {
    throw new Error(`Context node ${contextNodeId} not found`);
  }

  const resolvedEnvVars: Record<string, string> = resolveEnvVars(settings.INJECT_ENV_VARS);
  const contextNodeTitle: string = getNodeTitle(contextNode);
  const strippedTitle: string = contextNodeTitle.replace(/^ASK:\s*/i, '');
  const agentName: string = getNextAgentName();
  const title: string = `${agentName}: ${strippedTitle}`;

  const appSupportPath: string = getAppSupportPath();

  let initialSpawnDirectory: string | undefined = watchedDir ?? undefined;

  if (watchedDir && settings.terminalSpawnPathRelativeToWatchedDirectory) {
    const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
    initialSpawnDirectory = path.join(watchedDir, relativePath);
  }

  // Node IDs are now absolute paths, so contextNodeId is the absolute path
  const contextNodeAbsolutePath: string = contextNodeId;

  // Build absolute path for task node (parent of context node)
  // Node IDs are now absolute paths, so relativeFilePathIsID is the absolute path
  const parentNode: GraphNode | undefined = findFirstParentNode(contextNode, updatedGraph);
  const taskNodeAbsolutePath: string = parentNode
    ? parentNode.absoluteFilePathIsID
    : '';

  const unexpandedEnvVars: Record<string, string> = {
    VOICETREE_APP_SUPPORT: appSupportPath ?? '',
    CONTEXT_NODE_PATH: contextNodeAbsolutePath,
    TASK_NODE_PATH: taskNodeAbsolutePath,
    AGENT_NAME: agentName,
    ...resolvedEnvVars,
  };
  const expandedEnvVars: Record<string, string> = expandEnvVarsInValues(unexpandedEnvVars);

  const terminalData: TerminalData = createTerminalData({
    attachedToNodeId: contextNodeId,
    terminalCount: terminalCount,
    title: title,
    anchoredToNodeId: contextNodeId,
    initialCommand: command,
    executeCommand: true,
    initialSpawnDirectory: initialSpawnDirectory,
    initialEnvVars: expandedEnvVars,
    agentName: agentName,
  });

  // 5. Launch terminal via UI API
  void uiAPI.launchTerminalOntoUI(contextNodeId, terminalData);
}
