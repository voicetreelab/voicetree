/**
 * Main API object exposed to renderer process via IPC.
 *
 * NOTE: Do not define functions in this file - only import and re-export.
 * Each function should be defined in its own module.
 */

import {loadSettings, saveSettings as saveSettings} from '@/shell/edge/main/settings/settings_IO'
import type {VTSettings} from '@vt/graph-model/settings'
import {getWatchStatus, stopFileWatching, getVaultPaths, getReadPaths, getWriteFolder, getAvailableFoldersForSelector, createDatedVoiceTreeFolder, createSubfolder, openVault, getStartupVaultHint} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {getDirectoryTree} from '@/shell/edge/main/graph/watch_folder/folderScanning'
import {getBackendPort, getAppSupportPath} from "@/shell/edge/main/runtime/state/app-electron-state";
import {createContextNodeThroughDaemon as createContextNode} from './electron/daemon/queries/daemon-graph-queries'
import {getPreviewContainedNodeIdsThroughDaemon as getPreviewContainedNodeIds} from './electron/daemon/queries/daemon-graph-queries'
import {saveNodePositions} from "@/shell/edge/main/workspace/saveNodePositions";
import {performUndoThroughDaemon as performUndo, performRedoThroughDaemon as performRedo} from './electron/daemon/queries/daemon-graph-queries'
import {getVtDaemonFacade} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import type {
  CloseHeadlessAgent,
  GetHeadlessAgentOutput,
  GetUnseenNodesForTerminal,
  InjectNodesIntoTerminal,
  PatchTerminalRecord,
  RemoveTerminalFromRegistry,
  SendTextToTerminal,
  SpawnPlainTerminal,
  SpawnPlainTerminalWithNode,
  SpawnTerminalWithContextNode,
  TerminalId,
  TerminalRecordPatch,
  TerminalOperationResult,
  UnseenNodeInfo,
} from '@vt/vt-daemon-client'
import {
  attachUnclaimedTmuxSession,
  killUnclaimedTmuxSession,
  refreshUnclaimedTmuxSessions,
} from '@/shell/edge/main/agent/terminals/unclaimed-tmux-session-sync'
import {
  forkRecoverySession,
  refreshRecoverySessions,
  resumeRecoverySession,
} from '@/shell/edge/main/agent/terminals/recovery-session-sync'
import {askQuery} from './backend-api';
import {askModeCreateAndSpawn} from '@/shell/edge/main/agent/ask-mode/askModeCreateAndSpawn';
import {getMetrics} from '@/shell/edge/main/observability/metrics/getMetricsViaVtd';
import {getUsageData, refreshClaudeUsageHeadless} from '@/shell/edge/main/observability/usage/getUsageData';
import {openClaudeUsage, openCodexStatus} from '@/shell/edge/main/observability/usage/openUsageInTerminal';
import {getDaemonUrl} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding';
import {saveClipboardImage} from '@/shell/edge/main/workspace/clipboard/saveClipboardImage';
import {readImageAsDataUrl} from '@/shell/edge/main/workspace/clipboard/readImageAsDataUrl';
import {findFileByNameThroughDaemon as findFileByName} from './electron/daemon/queries/daemon-graph-queries';
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
import {getStarredFolders, addStarredFolder, removeStarredFolder, isStarred, copyNodeToFolder} from '@/shell/edge/main/graph/watch_folder/starredFolders';
import {listWorkflows, readSkillFile, readSkillFileSummary} from '@/shell/edge/main/workflows/workflowHandlers';
import {
  addReadPathThroughDaemon as addReadPath,
  collapseFolderThroughDaemon,
  expandFolderThroughDaemon,
  getGraphFromDaemon as getGraph,
  getProjectedGraphFromDaemon as getProjectedGraph,
  getNodeFromDaemon as getNode,
  postDeltaThroughDaemon,
  postDeltaThroughDaemonWithEditors,
  postWriteMarkdownFileThroughDaemon,
  removeReadPathThroughDaemon as removeReadPath,
  setFolderStateThroughDaemon,
  setWriteFolderThroughDaemon as setWriteFolder,
  syncRendererSessionStateWithDaemon,
  listViewsThroughDaemon,
  activateViewThroughDaemon,
  cloneViewThroughDaemon,
  deleteViewThroughDaemon,
} from './electron/daemon/ipc/daemon-ipc-proxy';
import { __debugLockSSE, __debugUnlockSSE } from './electron/daemon/sync/daemon-sse-subscription';
import { stopDaemonGraphSync } from './electron/daemon/sync/daemon-watch-sync';
import { shutdownActiveDaemonConnection as shutdownGraphDaemon } from './electron/daemon/lifecycle/graph-daemon';
import path from 'path';

async function __debugStopDaemonGraphSync(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test-only API');
  await stopDaemonGraphSync();
}

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

// ---------------------------------------------------------------------------
// BF-376 outbound: per-route wrappers fronting the per-vault VTD via
// @vt/vt-daemon-client. Renderer-facing IPC keeps its prior (terminalId,
// value) call shape; each wrapper folds that into the typed RPC request
// the daemon contract expects.
// ---------------------------------------------------------------------------

function spawnPlainTerminal(request: SpawnPlainTerminal.Request): Promise<void> {
    return getVtDaemonFacade().terminals.spawnPlainTerminal(request);
}

function spawnPlainTerminalWithNode(request: SpawnPlainTerminalWithNode.Request): Promise<void> {
    return getVtDaemonFacade().terminals.spawnPlainTerminalWithNode(request);
}

function spawnTerminalWithContextNode(
    request: SpawnTerminalWithContextNode.Request,
): Promise<SpawnTerminalWithContextNode.Response> {
    return getVtDaemonFacade().terminals.spawnTerminalWithContextNode(request);
}

function sendTextToTerminal(request: SendTextToTerminal.Request): Promise<TerminalOperationResult> {
    return getVtDaemonFacade().terminals.sendTextToTerminal(request);
}

function injectNodesIntoTerminal(
    request: InjectNodesIntoTerminal.Request,
): Promise<InjectNodesIntoTerminal.Response> {
    return getVtDaemonFacade().terminals.injectNodesIntoTerminal(request);
}

function getUnseenNodesForTerminal(
    request: GetUnseenNodesForTerminal.Request,
): Promise<readonly UnseenNodeInfo[]> {
    return getVtDaemonFacade().terminals.getUnseenNodesForTerminal(request);
}

function closeHeadlessAgent(request: CloseHeadlessAgent.Request): Promise<CloseHeadlessAgent.Response> {
    return getVtDaemonFacade().terminals.closeHeadlessAgent(request);
}

function getHeadlessAgentOutput(request: GetHeadlessAgentOutput.Request): Promise<string> {
    return getVtDaemonFacade().terminals.getHeadlessAgentOutput(request);
}

function removeTerminalFromRegistry(request: RemoveTerminalFromRegistry.Request): Promise<void> {
    return getVtDaemonFacade().terminals.removeTerminalFromRegistry(request);
}

function patchTerminalRecord(request: PatchTerminalRecord.Request): Promise<void> {
    return getVtDaemonFacade().terminals.patchTerminalRecord(request);
}

function updateTerminalIsDone(terminalId: TerminalId, value: boolean): Promise<void> {
    const patch: TerminalRecordPatch = { kind: 'done', value };
    return patchTerminalRecord({ terminalId, patch });
}

function updateTerminalPinned(terminalId: TerminalId, value: boolean): Promise<void> {
    const patch: TerminalRecordPatch = { kind: 'pinned', value };
    return patchTerminalRecord({ terminalId, patch });
}

function updateTerminalMinimized(terminalId: TerminalId, value: boolean): Promise<void> {
    const patch: TerminalRecordPatch = { kind: 'minimized', value };
    return patchTerminalRecord({ terminalId, patch });
}

function updateTerminalActivityState(
    terminalId: TerminalId,
    value: { lastOutputTime?: number; activityCount?: number },
): Promise<void> {
    const patch: TerminalRecordPatch = { kind: 'activity', value };
    return patchTerminalRecord({ terminalId, patch });
}

function listUnclaimedTmuxSessions(): ReturnType<ReturnType<typeof getVtDaemonFacade>['tmuxUnclaimed']['listUnclaimedTmuxSessions']> {
    return getVtDaemonFacade().tmuxUnclaimed.listUnclaimedTmuxSessions({});
}

export const mainAPI = {
  // Graph operations - daemon-only write path
  applyGraphDeltaToDBThroughMemUIAndEditorExposed: postDeltaThroughDaemonWithEditors,

  applyGraphDeltaToDBThroughMemAndUIExposed: postDeltaThroughDaemon,

  writeMarkdownFile: postWriteMarkdownFileThroughDaemon,

  getGraph,

  getProjectedGraph,

  getNode,

  // Collapse/expand through daemon RPC
  collapseFolderThroughDaemon,
  expandFolderThroughDaemon,
  setFolderStateThroughDaemon,

  // Position saving through daemon persistence
  saveNodePositions,

  // Settings operations
  loadSettings,

  saveSettings,

  // Vault operations — single canonical entry-point.
  openVault,

  getStartupVaultHint,

  stopFileWatching,

  shutdownGraphDaemon,

  getWatchStatus,

  // Multi-vault path operations
  getVaultPaths,
  getReadPaths,
  getWriteFolder,
  setWriteFolder,
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

  // Terminal spawning — RPC to per-vault VTD via @vt/vt-daemon-client.
  spawnTerminalWithContextNode: spawnTerminalWithContextNode,

  // Plain terminal spawning (no agent command, no context node)
  spawnPlainTerminal: spawnPlainTerminal,

  // Plain terminal with attached node (for draggability)
  spawnPlainTerminalWithNode: spawnPlainTerminalWithNode,

  // Terminal state mutations (renderer -> main -> VTD via patchTerminalRecord).
  // The four `updateTerminal*` shapes collapse to one polymorphic
  // `patchTerminalRecord` route on the wire — see design.md §1 "Registry
  // management". Each wrapper assembles the matching discriminator.
  updateTerminalIsDone: updateTerminalIsDone,
  updateTerminalPinned: updateTerminalPinned,
  updateTerminalMinimized: updateTerminalMinimized,
  updateTerminalActivityState: updateTerminalActivityState,
  removeTerminalFromRegistry: removeTerminalFromRegistry,
  closeAgent: closeHeadlessAgent,

  // Existing tmux sessions not yet claimed by this Electron registry
  listUnclaimedTmuxSessions: listUnclaimedTmuxSessions,
  refreshUnclaimedTmuxSessions,
  attachUnclaimedTmuxSession,
  killUnclaimedTmuxSession,

  // Unified recovery feed: live-tmux attach rows + dead-pane resumable rows
  refreshRecoverySessions,
  resumeRecoverySession,
  forkRecoverySession,

  // Manual node injection (InjectBar UI)
  getUnseenNodesForTerminal: getUnseenNodesForTerminal,
  injectNodesIntoTerminal: injectNodesIntoTerminal,

  // Inject text into a tmux-backed terminal (speech-to-terminal, etc.)
  sendTextToTerminal: sendTextToTerminal,

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

  // Daemon HTTP URL (Step 9 §2.7 discovery chain). Renderer reads this to
  // authorise its /rpc calls. Throws `daemon_unreachable` when the daemon
  // hasn't bound yet — caller treats as transient. The bearer token is no
  // longer exposed to the renderer; Main owns the /events and
  // /terminals/:id/attach WebSockets and bridges them over Electron IPC
  // (BF-367 + BF-368).
  getDaemonUrl,

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
  getHeadlessAgentOutput: getHeadlessAgentOutput,

  // Close (kill + deregister) a tmux-backed headless agent
  closeHeadlessAgent: closeHeadlessAgent,

  // Debug setup for Playwright MCP
  prettySetupAppForElectronDebugging,
  syncRendererSessionStateWithDaemon,
  __debugLockSSE,
  __debugUnlockSSE,
  __debugStopDaemonGraphSync,

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

  // View operations (folder-visibility per-project views)
  views: {
    list: listViewsThroughDaemon,
    activate: activateViewThroughDaemon,
    clone: cloneViewThroughDaemon,
    delete: deleteViewThroughDaemon,
  },
}
