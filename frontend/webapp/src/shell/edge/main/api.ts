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
import {getWatchStatus, loadPreviousFolder, startFileWatching, stopFileWatching, getVaultPaths, getReadOnLinkPaths, getWritePath, setWritePath, addReadOnLinkPath, removeReadOnLinkPath, getShowAllPaths, toggleShowAll} from './graph/watch_folder/watchFolder'
import {getBackendPort, getAppSupportPath} from "@/shell/edge/main/state/app-electron-state";
import {createContextNode} from "@/shell/edge/main/graph/context-nodes/createContextNode";
import {getPreviewContainedNodeIds} from "@/shell/edge/main/graph/context-nodes/getPreviewContainedNodeIds";
import {saveNodePositions} from "@/shell/edge/main/saveNodePositions";
import {performUndo, performRedo} from './graph/undoOperations'
import {spawnTerminalWithContextNode} from './terminals/spawnTerminalWithContextNode'
import {updateTerminalIsDone} from './terminals/terminal-registry'
import {spawnPlainTerminal, spawnPlainTerminalWithNode} from './terminals/spawnPlainTerminal'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange";
import {askQuery} from './backend-api';
import {askModeCreateAndSpawn} from './ask-mode/askModeCreateAndSpawn';
import {getMetrics} from './metrics/agent-metrics-store';
import {isMcpIntegrationEnabled, setMcpIntegration} from './mcp-server/mcp-client-config';
import {saveClipboardImage} from './clipboard/saveClipboardImage';

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

  // Multi-vault path operations
  getVaultPaths,
  getReadOnLinkPaths,
  getWritePath,
  setWritePath,
  addReadOnLinkPath,
  removeReadOnLinkPath,
  getShowAllPaths,
  toggleShowAll,

  // Backend port
  getBackendPort,

  createContextNode,

  getPreviewContainedNodeIds,

  // App paths
  getAppSupportPath,

  // Undo/Redo operations
  performUndo,
  performRedo,

  // Terminal spawning
  spawnTerminalWithContextNode,

  // Plain terminal spawning (no agent command, no context node)
  spawnPlainTerminal,

  // Plain terminal with attached node (for draggability)
  spawnPlainTerminalWithNode,

  // Terminal state sync (renderer -> main for MCP)
  updateTerminalIsDone,

  // Ask mode operations
  askQuery,

  askModeCreateAndSpawn,

  // Metrics
  getMetrics,

  // MCP client configuration
  isMcpIntegrationEnabled, //todo unused?
  setMcpIntegration,

  // Clipboard operations
  saveClipboardImage,
}
