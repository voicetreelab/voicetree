/**
 * Creates a context node from a question and spawns a terminal with the agent command.
 */

import path from 'path';
import * as O from 'fp-ts/lib/Option.js';
import type {Graph, NodeIdAndFilePath} from '@vt/graph-model/graph';
import {resolveEnvVarsWithSelection, expandEnvVarsInValues} from '@vt/graph-model/settings';
import type {VTSettings} from '@vt/graph-model/settings';
import {allocateUniqueAgentId, getDefaultAgent, pickAgentName} from '@vt/graph-model/settings';
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
import {getExistingAgentNames} from '@vt/vt-daemon-client';
import {getActiveProject, getVtDaemonClient} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding';
import {getVoicetreeHomePath} from '@/shell/edge/main/runtime/state/app-electron-state';
import {loadSettings} from '@/shell/edge/main/settings/settings_IO';
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {getWriteFolderPath} from '@/shell/edge/main/graph/watch_folder/watchFolder';
import {
  createContextNodeFromQuestionThroughDaemon,
  getGraphThroughDaemon,
} from '@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-queries';

export async function askModeCreateAndSpawn(relevantNodeIds: readonly string[], question: string): Promise<void> {
  const graph: Graph = await getGraphThroughDaemon();

  // Use writeFolderPath for normalizing search results - this matches what the backend loads from
  // (see watchFolder.ts:316 where notifyTextToTreeServerOfDirectory uses config.writeFolderPath)
  const writeFolderPathOption: O.Option<string> = await getWriteFolderPath();
  const basePath: string | null = O.isSome(writeFolderPathOption)
    ? writeFolderPathOption.value
    : null;

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
  const contextNodeResult: { nodeId: NodeIdAndFilePath; parentNodePath: NodeIdAndFilePath | ''; title: string } =
    await createContextNodeFromQuestionThroughDaemon(adjustedNodeIds, question);
  const contextNodeId: NodeIdAndFilePath = contextNodeResult.nodeId;

  // 3. Get terminal count from UI (we'll use 0 as default since we don't track it here)
  const terminalCount: number = 0;

  // 4. Load settings
  const settings: VTSettings = await loadSettings();
  const agents: readonly { readonly name: string; readonly command: string }[] = settings.agents ?? [];
  const command: string = getDefaultAgent(agents, settings.defaultAgent)?.command ?? '';

  if (!command) {
    throw new Error('No agent command available');
  }

  // 5. Prepare terminal data
  const resolvedEnvVars: Record<string, string> = resolveEnvVarsWithSelection(
    settings.INJECT_ENV_VARS,
    (values: readonly string[]) => Math.floor(Math.random() * values.length)
  );
  const strippedTitle: string = contextNodeResult.title.replace(/^ASK:\s*/i, '');
  // Generate unique agent name with collision handling
  const baseAgentName: string = pickAgentName(settings);
  const existingNames: ReadonlySet<string> = new Set(await getExistingAgentNames(getVtDaemonClient()));
  const agentName: string = allocateUniqueAgentId(baseAgentName, existingNames);
  const title: string = `${agentName}: ${strippedTitle}`;
  // terminalId = agentName (unified identification)
  const terminalId: TerminalId = agentName as TerminalId;

  const voicetreeHomePath: string = getVoicetreeHomePath();

  // Spawn directory is rooted at the project, NOT the writeFolderPath. writeFolderPath
  // can be a dated subdirectory of the project (see watchFolder.ts
  // createDatedVoiceTreeFolder), and the setting is
  // `terminalSpawnPathRelativeToWatchedDirectory` — historically rooted at
  // the watched (project) directory. basePath above stays as writeFolderPath
  // because the STT server returns paths relative to writeFolderPath.
  const projectPath: string | null = getActiveProject();
  let initialSpawnDirectory: string | undefined = projectPath ?? undefined;

  if (projectPath && settings.terminalSpawnPathRelativeToWatchedDirectory) {
    const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
    initialSpawnDirectory = path.join(projectPath, relativePath);
  }

  // Node IDs are now absolute paths, so contextNodeId is the absolute path
  const contextNodeAbsolutePath: string = contextNodeId;

  // Build absolute path for task node (parent of context node)
  // Node IDs are now absolute paths, so relativeFilePathIsID is the absolute path
  const taskNodeAbsolutePath: string = contextNodeResult.parentNodePath;

  const unexpandedEnvVars: Record<string, string> = {
    VOICETREE_HOME_PATH: voicetreeHomePath ?? '',
    CONTEXT_NODE_PATH: contextNodeAbsolutePath,
    TASK_NODE_PATH: taskNodeAbsolutePath,
    VOICETREE_TERMINAL_ID: agentName, // Same as AGENT_NAME
    AGENT_NAME: agentName,
    ...resolvedEnvVars,
  };
  const expandedEnvVars: Record<string, string> = expandEnvVarsInValues(unexpandedEnvVars);

  const terminalData: TerminalData = createTerminalData({
    terminalId: terminalId, // terminalId = agentName (unified)
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
