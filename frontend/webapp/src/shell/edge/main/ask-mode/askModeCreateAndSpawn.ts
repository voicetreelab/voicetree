/**
 * Creates a context node from a question and spawns a terminal with the agent command.
 */

import path from 'path';
import type {Graph, GraphNode, NodeIdAndFilePath} from '@/pure/graph';
import {getNodeTitle} from '@/pure/graph/markdown-parsing';
import {findFirstParentNode} from '@/pure/graph/graph-operations/findFirstParentNode';
import {resolveEnvVars, expandEnvVarsInValues} from '@/pure/settings';
import type {VTSettings} from '@/pure/settings/types';
import {getRandomAgentName} from '@/pure/settings/types';
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/types';
import {createTerminalData} from '@/shell/edge/UI-edge/floating-windows/types';
import {getAppSupportPath} from '@/shell/edge/main/state/app-electron-state';
import {getGraph} from '@/shell/edge/main/state/graph-store';
import {getWatchStatus, getWatchedDirectory} from '@/shell/edge/main/graph/watch_folder/watchFolder';
import {loadSettings} from '@/shell/edge/main/settings/settings_IO';
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';
import {createContextNodeFromQuestion} from '@/shell/edge/main/graph/context-nodes/createContextNodeFromQuestion';

export async function askModeCreateAndSpawn(relevantNodeIds: readonly string[], question: string): Promise<void> {
  // Fix: Prepend vault suffix to node IDs from backend
  // Backend returns paths relative to vault (e.g., 'voice/Node.md')
  // Frontend graph keys include vault suffix (e.g., 'vt/voice/Node.md')
  const vaultSuffix: string = getWatchStatus().vaultSuffix;
  const adjustedNodeIds: readonly string[] = vaultSuffix
    ? relevantNodeIds.map(id => `${vaultSuffix}/${id}`)
    : relevantNodeIds;

  // 1. Create context node from relevant nodes
  const contextNodeId: NodeIdAndFilePath = await createContextNodeFromQuestion(adjustedNodeIds, question);

  // 2. Get terminal count from UI (we'll use 0 as default since we don't track it here)
  const terminalCount: number = 0;

  // 3. Load settings
  const settings: VTSettings = await loadSettings();
  const agents: readonly { readonly name: string; readonly command: string }[] = settings.agents ?? [];
  const command: string = agents[0]?.command ?? '';

  if (!command) {
    throw new Error('No agent command available');
  }

  // 4. Prepare terminal data
  const graph: Graph = getGraph();
  const contextNode: GraphNode = graph.nodes[contextNodeId];
  if (!contextNode) {
    throw new Error(`Context node ${contextNodeId} not found`);
  }

  const contextContent: string = contextNode.contentWithoutYamlOrLinks;
  const resolvedEnvVars: Record<string, string> = resolveEnvVars(settings.INJECT_ENV_VARS);
  const contextNodeTitle: string = getNodeTitle(contextNode);
  const strippedTitle: string = contextNodeTitle.replace(/^ASK:\s*/i, '');
  const agentName: string = getRandomAgentName();
  const title: string = `${agentName}: ${strippedTitle}`;

  const watchStatus: { readonly isWatching: boolean; readonly directory: string | undefined } = getWatchStatus();
  let initialSpawnDirectory: string | undefined = watchStatus.directory;

  if (watchStatus?.directory && settings.terminalSpawnPathRelativeToWatchedDirectory) {
    const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
    initialSpawnDirectory = path.join(watchStatus.directory, relativePath);
  }

  const appSupportPath: string = getAppSupportPath();
  const watchedDir: string | null = getWatchedDirectory();
  const contextNodeAbsolutePath: string = watchedDir
    ? path.join(watchedDir, contextNodeId)
    : contextNodeId;

  // Build absolute path for task node (parent of context node)
  const parentNode: GraphNode | undefined = findFirstParentNode(contextNode, graph);
  const taskNodeAbsolutePath: string = parentNode && watchedDir
    ? path.join(watchedDir, parentNode.relativeFilePathIsID)
    : '';

  // Truncate context content to avoid posix_spawnp failure from env size limits
  // Full content is available at CONTEXT_NODE_PATH
  const MAX_CONTEXT_CONTENT_LENGTH: number = 64000;
  const truncatedContextContent: string = contextContent.length > MAX_CONTEXT_CONTENT_LENGTH
    ? contextContent.slice(0, MAX_CONTEXT_CONTENT_LENGTH) + '\n\n[Content truncated - full content available at $CONTEXT_NODE_PATH]'
    : contextContent;

  const unexpandedEnvVars: Record<string, string> = {
    VOICETREE_APP_SUPPORT: appSupportPath ?? '',
    CONTEXT_NODE_PATH: contextNodeAbsolutePath,
    TASK_NODE_PATH: taskNodeAbsolutePath,
    CONTEXT_NODE_CONTENT: truncatedContextContent,
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
  });

  // 5. Launch terminal via UI API
  void uiAPI.launchTerminalOntoUI(contextNodeId, terminalData);
}
