import type { GraphDelta } from '../graph'
import type { FolderTreeNode } from '../folders/types'

export interface GraphModelConfig {
  appSupportPath: string  // replaces app.getPath('userData')
}

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
  enableMcpIntegration?: () => Promise<void>  // replaces mcp-server/mcp-client-config
  ensureProjectSetup?: (projectPath: string) => Promise<void>  // replaces electron/tools-setup
  ensureDaemonForVault?: (projectRoot: string) => Promise<void>
  getOnboardingDirectory?: () => string  // replaces electron/onboarding-setup
}

// Module-level DI state
let _config: GraphModelConfig | undefined
let _callbacks: GraphModelCallbacks = {}

export function initGraphModel(config: GraphModelConfig, callbacks?: GraphModelCallbacks): void {
  _config = config
  _callbacks = callbacks ?? {}
}

export function getConfig(): GraphModelConfig {
  if (!_config) throw new Error('GraphModel not initialized. Call initGraphModel() first.')
  return _config
}

export function getCallbacks(): GraphModelCallbacks {
  return _callbacks
}
