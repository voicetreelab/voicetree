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
import type {VTSettings} from '@/pure/settings/types'
import {getWatchStatus, loadPreviousFolder, markFrontendReady, startFileWatching, stopFileWatching, getVaultPaths, getReadPaths, getWritePath, setWritePath, addReadPath, removeReadPath, getAvailableFoldersForSelector, createDatedVoiceTreeFolder} from './graph/watch_folder/watchFolder'
import {getBackendPort, getAppSupportPath} from "@/shell/edge/main/state/app-electron-state";
import {createContextNode} from "@/shell/edge/main/graph/context-nodes/createContextNode";
import {getPreviewContainedNodeIds} from "@/shell/edge/main/graph/context-nodes/getPreviewContainedNodeIds";
import {saveNodePositions} from "@/shell/edge/main/saveNodePositions";
import {performUndo, performRedo} from './graph/undoOperations'
import {spawnTerminalWithContextNode} from './terminals/spawnTerminalWithContextNode'
import {updateTerminalIsDone, updateTerminalPinned, updateTerminalActivityState, removeTerminalFromRegistry} from './terminals/terminal-registry'
import {getUnseenNodesForTerminal} from './terminals/get-unseen-nodes-for-terminal'
import {injectNodesIntoTerminal} from './terminals/inject-nodes-into-terminal'
import {spawnPlainTerminal, spawnPlainTerminalWithNode} from './terminals/spawnPlainTerminal'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange";
import {askQuery} from './backend-api';
import {askModeCreateAndSpawn} from './ask-mode/askModeCreateAndSpawn';
import {getMetrics} from './metrics/agent-metrics-store';
import {isMcpIntegrationEnabled, setMcpIntegration} from './mcp-server/mcp-client-config';
import {getMcpPort} from './mcp-server/mcp-server';
import {saveClipboardImage} from './clipboard/saveClipboardImage';
import {readImageAsDataUrl} from './clipboard/readImageAsDataUrl';
import {findFileByName} from './graph/loading/findFileByName';
import {runAgentOnSelectedNodes} from './runAgentOnSelectedNodes';
import {listWorktrees, createWorktree as createWorktreeCore, generateWorktreeName, removeWorktree, getRemoveWorktreeCommand} from './worktree/gitWorktreeCommands';
import {scanForProjects, getDefaultSearchDirectories} from './project-scanner';
import {loadProjects, saveProject, removeProject} from './project-store';
import {initializeProject as initializeProjectCore} from './project-initializer';
import {showFolderPicker, createNewProject} from './show-folder-picker';
import {getOnboardingDirectory} from './electron/onboarding-setup';
import {prettySetupAppForElectronDebugging} from './debug/prettySetupAppForElectronDebugging';
import {getHeadlessAgentOutput} from './terminals/headlessAgentManager';
import {
  checkMicrophonePermission,
  requestMicrophonePermission,
  openMicrophoneSettings
} from './microphone-permissions';
import {
  getStarredFolders,
  addStarredFolder,
  removeStarredFolder,
  isStarred,
  copyNodeToFolder,
} from './graph/watch_folder/starred-folders';
import path from 'path';

/**
 * Wrapper for initializeProject that provides the onboarding source directory.
 * Copies onboarding .md files from Application Support into the project's voicetree folder.
 * Returns the path to the voicetree subfolder (existing or newly created).
 */
async function initializeProject(projectPath: string): Promise<string | null> {
    const onboardingSourceDir: string = path.join(getOnboardingDirectory(), 'voicetree');
    return initializeProjectCore(projectPath, onboardingSourceDir);
}

/**
 * Wrapper for createWorktree that reads hooks.onWorktreeCreated from settings
 * and passes it to the core function. Hook failure is non-blocking.
 */
async function createWorktree(repoRoot: string, worktreeName: string): Promise<string> {
    const settings: VTSettings = await loadSettings();
    const blockingHook: string | undefined = settings.hooks?.onWorktreeCreatedBlocking;
    const asyncHook: string | undefined = settings.hooks?.postWorktreeCreatedAsync;
    const effectiveBlocking: string | undefined = blockingHook?.startsWith('#') ? undefined : blockingHook ?? undefined;
    const effectiveAsync: string | undefined = asyncHook?.startsWith('#') ? undefined : asyncHook ?? undefined;
    return createWorktreeCore(repoRoot, worktreeName, effectiveBlocking, effectiveAsync);
}

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

  // Frontend readiness signal - triggers initial folder load
  markFrontendReady,

  // Multi-vault path operations
  getVaultPaths,
  getReadPaths,
  getWritePath,
  setWritePath,
  addReadPath,
  removeReadPath,
  getAvailableFoldersForSelector,
  createDatedVoiceTreeFolder,

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

  // Terminal state mutations (renderer -> main for MCP)
  updateTerminalIsDone,
  updateTerminalPinned,
  updateTerminalActivityState,
  removeTerminalFromRegistry,

  // Manual node injection (InjectBar UI)
  getUnseenNodesForTerminal,
  injectNodesIntoTerminal,

  // Ask mode operations
  askQuery,

  askModeCreateAndSpawn,

  // Metrics
  getMetrics,

  // MCP client configuration
  isMcpIntegrationEnabled, //todo unused?
  setMcpIntegration,
  getMcpPort,

  // Clipboard operations
  saveClipboardImage,

  // Image loading
  readImageAsDataUrl,

  // File search
  findFileByName,

  // Run Agent on Selected Nodes
  runAgentOnSelectedNodes,

  // Project selection operations
  scanForProjects,
  getDefaultSearchDirectories,
  loadProjects,
  saveProject,
  removeProject,
  initializeProject,
  showFolderPicker,
  createNewProject,

  // Headless agent output (ring buffer) for hover tooltip
  getHeadlessAgentOutput,

  // Debug setup for Playwright MCP
  prettySetupAppForElectronDebugging,

  // Microphone permissions (macOS)
  checkMicrophonePermission,
  requestMicrophonePermission,
  openMicrophoneSettings,

  // Worktree operations
  listWorktrees,
  createWorktree,
  generateWorktreeName,
  removeWorktree,
  getRemoveWorktreeCommand,

  // Starred folders
  getStarredFolders,
  addStarredFolder,
  removeStarredFolder,
  isStarred,
  copyNodeToFolder,
}
