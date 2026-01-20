/**
 * Creates a context node from a question and spawns a terminal with the agent command.
 */

import path from 'path';
import type {Graph, GraphNode, NodeIdAndFilePath} from '@/pure/graph';
import {getNodeTitle} from '@/pure/graph/markdown-parsing';
import {findFirstParentNode} from '@/pure/graph/graph-operations/findFirstParentNode';
import {resolveEnvVars, expandEnvVarsInValues} from '@/pure/settings';
import type {VTSettings} from '@/pure/settings/types';
import {getNextAgentName} from '@/pure/settings/types';
import {createTerminalData} from '@/shell/edge/UI-edge/floating-windows/types';
import {getAppSupportPath} from '@/shell/edge/main/state/app-electron-state';
import {getGraph} from '@/shell/edge/main/state/graph-store';
import {getWatchedDirectory} from '@/shell/edge/main/graph/watch_folder/watchFolder';
import {loadSettings} from '@/shell/edge/main/settings/settings_IO';
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';
import {createContextNodeFromQuestion} from '@/shell/edge/main/graph/context-nodes/createContextNodeFromQuestion';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

export async function askModeCreateAndSpawn(relevantNodeIds: readonly string[], question: string): Promise<void> {
  // Get graph - node IDs are now absolute paths that match graph keys directly
  const graph: Graph = getGraph();
  const watchedDir: string | null = getWatchedDirectory();

  // Normalize incoming node IDs to absolute paths
  // Backend returns relative paths like "voice/note.md" but graph uses absolute paths
  const normalizedNodeIds: readonly string[] = relevantNodeIds.map(id => {
    if (path.isAbsolute(id)) return id;
    return watchedDir ? path.join(watchedDir, id) : id;
  });

  // Filter to only node IDs that exist in the graph
  const adjustedNodeIds: readonly string[] = normalizedNodeIds
    .filter(id => graph.nodes[id] !== undefined);

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
  const contextNode: GraphNode = graph.nodes[contextNodeId];
  if (!contextNode) {
    throw new Error(`Context node ${contextNodeId} not found`);
  }

  const contextContent: string = contextNode.contentWithoutYamlOrLinks;
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
  const parentNode: GraphNode | undefined = findFirstParentNode(contextNode, graph);
  const taskNodeAbsolutePath: string = parentNode
    ? parentNode.absoluteFilePathIsID
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
