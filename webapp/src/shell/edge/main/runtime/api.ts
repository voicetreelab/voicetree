/**
 * Main API object exposed to renderer process via IPC.
 *
 * NOTE: Do not define functions in this file - only import and re-export.
 * Each function should be defined in its own module.
 */

import {loadSettings, saveSettings as saveSettings} from './settings/settings_IO'
import type {VTSettings} from '@vt/graph-model/settings'
import {getWatchStatus, loadPreviousFolder, markFrontendReady, startFileWatching, stopFileWatching, getVaultPaths, getReadPaths, getWritePath, getAvailableFoldersForSelector, createDatedVoiceTreeFolder, createSubfolder} from './graph/watch_folder/watchFolder'
import {getDirectoryTree} from './graph/watch_folder/folderScanning'
import {getBackendPort, getAppSupportPath} from "@/shell/edge/main/runtime/state/app-electron-state";
import {createContextNodeThroughDaemon as createContextNode} from './electron/daemon/daemon-graph-queries'
import {getPreviewContainedNodeIdsThroughDaemon as getPreviewContainedNodeIds} from './electron/daemon/daemon-graph-queries'
import {saveNodePositions} from "@/shell/edge/main/workspace/saveNodePositions";
import {performUndoThroughDaemon as performUndo, performRedoThroughDaemon as performRedo} from './electron/daemon/daemon-graph-queries'
import {agentRuntime} from '@vt/agent-runtime'
import {askQuery} from './backend-api';
import {askModeCreateAndSpawn} from '@/shell/edge/main/agent/ask-mode/askModeCreateAndSpawn';
import {getMetrics} from '@/shell/edge/main/observability/metrics/agent-metrics-store';
import {getUsageData, refreshClaudeUsageHeadless} from '@/shell/edge/main/observability/usage/getUsageData';
import {openClaudeUsage, openCodexStatus} from '@/shell/edge/main/observability/usage/openUsageInTerminal';
import {getMcpPort, isMcpIntegrationEnabled, setMcpIntegration} from '@vt/voicetree-mcp';
import {saveClipboardImage} from '@/shell/edge/main/workspace/clipboard/saveClipboardImage';
import {readImageAsDataUrl} from '@/shell/edge/main/workspace/clipboard/readImageAsDataUrl';
import {findFileByNameThroughDaemon as findFileByName} from './electron/daemon/daemon-graph-queries';
import {runAgentOnSelectedNodes} from '@/shell/edge/main/agent/runAgentOnSelectedNodes';
import {listWorktrees, createWorktree as createWorktreeCore, generateWorktreeName, removeWorktree, getRemoveWorktreeCommand} from '@/shell/edge/main/workspace/worktree/gitWorktreeCommands';
import {scanForProjects, getDefaultSearchDirectories} from '@/shell/edge/main/workspace/project-scanner';
import {loadProjects, saveProject, removeProject} from '@/shell/edge/main/workspace/project-store';
import {initializeProject as initializeProjectCore} from '@/shell/edge/main/workspace/project-initializer';
import {showFolderPicker, createNewProject} from '@/shell/edge/main/workspace/show-folder-picker';
import {getOnboardingDirectory} from './electron/startup/onboarding-setup';
import {prettySetupAppForElectronDebugging} from '@/shell/edge/main/observability/debug/prettySetupAppForElectronDebugging';
import {
  checkMicrophonePermission,
  requestMicrophonePermission,
  openMicrophoneSettings
} from './microphone-permissions';
import {getStarredFolders, addStarredFolder, removeStarredFolder, isStarred, copyNodeToFolder} from './graph/watch_folder/starredFolders';
import {listWorkflows, readSkillFile, readSkillFileSummary} from './workflows/workflowHandlers';
import {
  addReadPathThroughDaemon as addReadPath,
  collapseFolderThroughDaemon,
  expandFolderThroughDaemon,
  getGraphFromDaemon as getGraph,
  getProjectedGraphFromDaemon as getProjectedGraph,
  getLiveStateSnapshotFromDaemon as getLiveStateSnapshot,
  getNodeFromDaemon as getNode,
  postDeltaThroughDaemon,
  postDeltaThroughDaemonWithEditors,
  removeReadPathThroughDaemon as removeReadPath,
  setWritePathThroughDaemon as setWritePath,
  syncRendererSessionStateWithDaemon,
} from './electron/daemon/daemon-ipc-proxy';
import { __debugLockSSE, __debugUnlockSSE } from './electron/daemon/daemon-sse-subscription';
import { shutdownActiveDaemonConnection as shutdownGraphDaemon } from './electron/daemon/graph-daemon';
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

export const mainAPI = {
  // Graph operations - daemon-only write path
  applyGraphDeltaToDBThroughMemUIAndEditorExposed: postDeltaThroughDaemonWithEditors,

    applyGraphDeltaToDBThroughMemAndUIExposed: postDeltaThroughDaemon,

  getGraph,

  getProjectedGraph,

  getNode,

  // Collapse/expand through daemon RPC
  collapseFolderThroughDaemon,
  expandFolderThroughDaemon,

  // Position saving through daemon persistence
  saveNodePositions,

  // Settings operations
  loadSettings,

  saveSettings,

  // File watching operations - thin wrappers
  startFileWatching,

  stopFileWatching,

  shutdownGraphDaemon,

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
  createSubfolder,

  // Directory tree (recursive listing for FolderTreeSidebar)
  getDirectoryTree,

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
  spawnTerminalWithContextNode: agentRuntime.spawnTerminalWithContextNode,

  // Plain terminal spawning (no agent command, no context node)
  spawnPlainTerminal: agentRuntime.spawnPlainTerminal,

  // Plain terminal with attached node (for draggability)
  spawnPlainTerminalWithNode: agentRuntime.spawnPlainTerminalWithNode,

  // Terminal state mutations (renderer -> main for MCP)
  updateTerminalIsDone: agentRuntime.updateTerminalIsDone,
  updateTerminalPinned: agentRuntime.updateTerminalPinned,
  updateTerminalMinimized: agentRuntime.updateTerminalMinimized,
  updateTerminalActivityState: agentRuntime.updateTerminalActivityState,
  removeTerminalFromRegistry: agentRuntime.removeTerminalFromRegistry,

  // Manual node injection (InjectBar UI)
  getUnseenNodesForTerminal: agentRuntime.getUnseenNodesForTerminal,
  injectNodesIntoTerminal: agentRuntime.injectNodesIntoTerminal,

  // Ask mode operations
  askQuery,

  askModeCreateAndSpawn,

  // Metrics
  getMetrics,

  // Claude Code + Codex usage data
  getUsageData,
  refreshClaudeUsageHeadless,
  openClaudeUsage,
  openCodexStatus,

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
  getHeadlessAgentOutput: agentRuntime.getHeadlessAgentOutput,

  // Debug setup for Playwright MCP
  prettySetupAppForElectronDebugging,
  getLiveStateSnapshot,
  syncRendererSessionStateWithDaemon,
  __debugLockSSE,
  __debugUnlockSSE,

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

  // Workflow operations
  listWorkflows,
  readSkillFile,
  readSkillFileSummary,
}
