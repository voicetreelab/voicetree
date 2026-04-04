import type { GraphDelta } from '@/pure/graph'
import type { FolderTreeNode } from '@/pure/folders/types'

export interface GraphModelConfig {
  appSupportPath: string  // replaces app.getPath('userData')
}

export interface GraphModelCallbacks {
  // Core graph broadcasting
  onGraphDelta?: (delta: GraphDelta) => void  // replaces broadcastGraphDeltaToUI / mainWindow.webContents.send
  onFloatingEditorUpdate?: (delta: GraphDelta) => void  // replaces uiAPI.updateFloatingEditorsFromExternal
  onGraphCleared?: () => void  // replaces mainWindow.webContents.send('graph:clear')

  // Settings
  onSettingsChanged?: () => void  // replaces uiAPI.onSettingsChanged

  // Watch folder events
  onWatchingStarted?: (info: { directory: string; writePath: string; timestamp: string }) => void
  onFolderCleared?: () => void

  // Dialogs (Electron-specific, no-op in headless mode)
  openFolderDialog?: () => Promise<string | undefined>  // replaces dialog.showOpenDialog
  showInfoDialog?: (title: string, message: string) => Promise<void>  // replaces dialog.showMessageBox

  // UI state syncing
  fitViewport?: () => void  // replaces uiAPI.fitViewport
  syncVaultState?: (state: { readPaths: readonly string[]; writePath: string | null; starredFolders: readonly string[] }) => void
  syncFolderTree?: (tree: FolderTreeNode) => void
  syncStarredFolderTrees?: (trees: Record<string, FolderTreeNode>) => void
  syncExternalFolderTrees?: (trees: Record<string, FolderTreeNode>) => void

  // Hooks
  onNewNodeHook?: (nodeId: string, graphData: GraphDelta) => void  // replaces hooks/onNewNodeHook
  refreshBadge?: () => void  // replaces terminals/inject-badge-refresh

  // Backend notification
  notifyWriteDirectory?: (dirPath: string) => void  // replaces backend-api.tellSTTServerToLoadDirectory

  // Semantic search (for context nodes)
  semanticSearch?: (query: string, topK: number) => Promise<readonly string[]>

  // App-specific setup callbacks (Electron)
  enableMcpIntegration?: () => Promise<void>  // replaces mcp-server/mcp-client-config
  ensureProjectSetup?: (projectPath: string) => Promise<void>  // replaces electron/tools-setup
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
