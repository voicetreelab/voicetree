import type { GraphDelta } from '../graph'
import type { FolderTreeNode } from '../folders/types'

// `projectRoot` is the canonical root for per-project `.voicetree/` data
// (terminal metadata, hooks, positions). `directory` is the legacy alias for
// the same value, retained on the renderer-bound `'watching-started'` channel
// payload until renderer code migrates. New consumers should read
// `projectRoot`. `writeFolder` is for markdown / vault content only.
type WatchingStartedInfo = {
  directory: string
  projectRoot: string
  writeFolder: string
  timestamp: string
}

export interface GraphModelCallbacks {
  // Core graph broadcasting
  onFloatingEditorUpdate?: (delta: GraphDelta, suppressForSubscribers?: readonly string[]) => void  // replaces uiAPI.updateFloatingEditorsFromExternal
  onGraphCleared?: () => void  // replaces mainWindow.webContents.send('graph:clear')

  // Settings
  onSettingsChanged?: () => void  // replaces uiAPI.onSettingsChanged

  // Watch folder events
  onVaultSwitching?: () => void | Promise<void>
  onVaultOpened?: (info: WatchingStartedInfo) => void | Promise<void>
  onWatchingStarted?: (info: WatchingStartedInfo) => void
  onFolderCleared?: () => void

  // Dialogs (Electron-specific, no-op in headless mode)
  openFolderDialog?: () => Promise<string | undefined>  // replaces dialog.showOpenDialog
  showInfoDialog?: (title: string, message: string) => Promise<void>  // replaces dialog.showMessageBox

  // UI state syncing
  fitViewport?: () => void  // replaces uiAPI.fitViewport
  syncVaultState?: (state: { vaultPaths: readonly string[]; writeFolder: string | null; starredFolders: readonly string[] }) => void
  syncFolderTree?: (tree: FolderTreeNode) => void
  syncStarredFolderTrees?: (trees: Record<string, FolderTreeNode>) => void
  syncExternalFolderTrees?: (trees: Record<string, FolderTreeNode>) => void

  // Hooks
  onNewNodeHook?: (nodeId: string, graphData: GraphDelta) => void  // replaces hooks/onNewNodeHook
  onFSNodeWithAgentName?: (agentName: string, nodeId: string, title: string) => void
  refreshBadge?: () => void  // replaces terminals/inject-badge-refresh

  // Backend notification
  notifyWriteDirectory?: (dirPath: string) => void  // replaces backend-api.tellSTTServerToLoadDirectory

  // Active vault paths
  getWriteFolder?: () => Promise<string | null>

  // Semantic search (for context nodes)
  semanticSearch?: (query: string, topK: number) => Promise<readonly string[]>

  // App-specific setup callbacks (Electron)
  stripStaleMcpEntries?: (vaultDir: string) => Promise<void>
  writeVaultAgentDiscoveryFile?: (vaultDir: string) => Promise<void>
  ensureProjectSetup?: (projectPath: string) => Promise<void>  // replaces electron/tools-setup
  ensureDaemonForVault?: (projectRoot: string) => Promise<void>
  getOnboardingDirectory?: () => string  // replaces electron/onboarding-setup
}

// Module-level callbacks. The voicetreeHomePath that previously lived here is
// now resolved per-call from $VOICETREE_HOME_PATH via
// @vt/paths (see resolveVoicetreeHomePath); each
// launching process normalises the env var at boot.
let _callbacks: GraphModelCallbacks = {}

export function initGraphModel(callbacks?: GraphModelCallbacks): void {
  _callbacks = callbacks ?? {}
}

export function getCallbacks(): GraphModelCallbacks {
  return _callbacks
}
