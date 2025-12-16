/**
 * Main API object exposed to renderer process via IPC.
 *
 * NOTE: Do not define functions in this file - only import and re-export.
 * Each function should be defined in its own module.
 */

import {
    applyGraphDeltaToDBThroughMemAndUI
} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI'
import {getGraph, getNode} from '@/shell/edge/main/state/graph-store'
import {loadSettings, saveSettings as saveSettings} from './settings/settings_IO'
import {getWatchStatus, loadPreviousFolder, startFileWatching, stopFileWatching, setVaultSuffix} from './graph/watchFolder'
import {getBackendPort, getAppSupportPath} from "@/shell/edge/main/state/app-electron-state";
import {createContextNode} from "@/shell/edge/main/graph/context-nodes/createContextNode";
import {createContextNodeFromQuestion} from "@/shell/edge/main/graph/context-nodes/createContextNodeFromQuestion";
import {saveNodePositions} from "@/shell/edge/main/saveNodePositions";
import {performUndo, performRedo} from './graph/undoOperations'
import {spawnTerminalWithContextNode} from './terminals/spawnTerminalWithContextNode'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange";
import {askQuery as askQueryBackend, type AskQueryResponse} from './backend-api';
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/types';
import {createTerminalData} from '@/shell/edge/UI-edge/floating-windows/types';
import type {VTSettings} from '@/pure/settings/types';
import {resolveEnvVars, expandEnvVarsInValues} from '@/pure/settings';
import type {Graph, GraphNode, NodeIdAndFilePath} from '@/pure/graph';
import {getNodeTitle} from '@/pure/graph/markdown-parsing';
import {getWatchedDirectory} from './graph/watchFolder';

// eslint-disable-next-line @typescript-eslint/typedef
export const mainAPI = {
  // Graph operations - renderer-friendly wrappers
  applyGraphDeltaToDBThroughMemUIAndEditorExposed: applyGraphDeltaToDBThroughMemAndUIAndEditors,

    applyGraphDeltaToDBThroughMemAndUIExposed: applyGraphDeltaToDBThroughMemAndUI,

  getGraph,

  getNode,

  // Position saving - lightweight in-memory update
  saveNodePositions,

  // Settings operations
  loadSettings,

  saveSettings,

  // File watching operations - thin wrappers
  startFileWatching,

  stopFileWatching,

  getWatchStatus,

  loadPreviousFolder,

  // Vault suffix operations
  setVaultSuffix,

  // Backend port
  getBackendPort,

  createContextNode,

  // App paths
  getAppSupportPath,

  // Undo/Redo operations
  performUndo,
  performRedo,

  // Terminal spawning
  spawnTerminalWithContextNode,

  // Ask mode operations
  askQuery: async (query: string, topK: number = 10): Promise<AskQueryResponse> => {
    return askQueryBackend(query, topK);
  },

  askModeCreateAndSpawn: async (relevantNodeIds: readonly string[], question: string): Promise<void> => {
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
    const agentName: string = resolvedEnvVars['AGENT_NAME'] ?? '';
    const title: string = agentName ? `${agentName}: ${strippedTitle}` : strippedTitle;

    const watchStatus: { readonly isWatching: boolean; readonly directory: string | undefined } = getWatchStatus();
    let initialSpawnDirectory: string | undefined = watchStatus.directory;

    if (watchStatus?.directory && settings.terminalSpawnPathRelativeToWatchedDirectory) {
      const baseDir: string = watchStatus.directory.replace(/\/$/, '');
      const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
      initialSpawnDirectory = `${baseDir}/${relativePath}`;
    }

    const appSupportPath: string = getAppSupportPath();
    const watchedDir: string | null = getWatchedDirectory();
    const contextNodeAbsolutePath: string = watchedDir
      ? `${watchedDir.replace(/\/$/, '')}/${contextNodeId}`
      : contextNodeId;

    const unexpandedEnvVars: Record<string, string> = {
      VOICETREE_APP_SUPPORT: appSupportPath ?? '',
      CONTEXT_NODE_PATH: contextNodeAbsolutePath,
      CONTEXT_NODE_CONTENT: contextContent,
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
  },
}
