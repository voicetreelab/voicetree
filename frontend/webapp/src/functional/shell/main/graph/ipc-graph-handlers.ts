import { ipcMain, dialog } from 'electron'
import type { GraphDelta } from '@/functional/pure/graph/types.ts'
import { getGraph } from '@/functional/shell/state/graph-store.ts'
import { loadFolder, stopWatching, isWatching, getWatchedDirectory, initialLoad } from '@/functional/shell/main/graph/watchFolder.ts'
import fs from 'fs'
import type TerminalManager from '@/electron/terminal-manager.ts'
import type PositionManager from '@/electron/position-manager.ts'
import { applyGraphDeltaToDB } from '@/functional/shell/main/graph/writePath/applyGraphDeltaToDB.ts'

interface IpcHandlerDependencies {
  readonly terminalManager: TerminalManager
  readonly positionManager: PositionManager
  readonly getBackendPort: () => number | null
  readonly getToolsDirectory: () => string
}

export function registerAllIpcHandlers(deps: IpcHandlerDependencies) {
  //FROM UI  TO DB
    // GRAPH UPDATE - handles all node actions (create, update, delete)
  ipcMain.handle('graph:applyDelta', async (_event, action: GraphDelta) => {
      console.log("! apply delta called in main")
      await applyGraphDeltaToDB(getGraph(), action)
  })

  // QUERY GRAPH STATE
  ipcMain.handle('graph:getState', async () => {
    return getGraph()
  })

  // Backend server port
  ipcMain.handle('get-backend-port', () => {
    return deps.getBackendPort()
  })

  // File watching handlers
  ipcMain.handle('start-file-watching', async (_event, directoryPath) => {
    console.log('[IPC] start-file-watching handler called, directoryPath:', directoryPath);
    // Get selected directory (either from param or via dialog)
    const getDirectory = async (): Promise<string | null> => {
      if (directoryPath) {
        console.log('[IPC] Using provided directory path:', directoryPath);
        return directoryPath
      }

      console.log('[IPC] No directory provided, showing dialog...');

      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Directory to Watch for Markdown Files',
        buttonLabel: 'Watch Directory',
        defaultPath: getWatchedDirectory() || process.env.HOME || '/'
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return result.filePaths[0]
    }

    const selectedDirectory = await getDirectory()
    console.log('[IPC] Selected directory:', selectedDirectory);

    if (!selectedDirectory) {
      console.log('[IPC] No directory selected, returning error');
      return { success: false, error: 'No directory selected' }
    }

    // FAIL FAST: Validate directory exists before proceeding
    console.log('[IPC] Validating directory exists...');
    if (!fs.existsSync(selectedDirectory)) {
      const error = `Directory does not exist: ${selectedDirectory}`
      console.error('[IPC] start-file-watching failed:', error)
      return { success: false, error }
    }

    console.log('[IPC] Validating path is a directory...');
    if (!fs.statSync(selectedDirectory).isDirectory()) {
      const error = `Path is not a directory: ${selectedDirectory}`
      console.error('[IPC] start-file-watching failed:', error)
      return { success: false, error }
    }

    console.log('[IPC] Calling loadFolder...');
    await loadFolder(selectedDirectory)
    console.log('[IPC] loadFolder completed successfully');
    return { success: true, directory: selectedDirectory }
  })

  ipcMain.handle('stop-file-watching', async () => {
    await stopWatching()
    return { success: true }
  })

  ipcMain.handle('get-watch-status', () => {
    const status = {
      isWatching: isWatching(),
      directory: getWatchedDirectory()
    }
    console.log('Watch status:', status)
    return status
  })

  ipcMain.handle('load-previous-folder', async () => {
    console.log('[IPC] load-previous-folder handler called');
    await initialLoad();
    const watchedDir = getWatchedDirectory();
    if (watchedDir) {
      console.log('[IPC] Successfully loaded previous folder:', watchedDir);
      return { success: true, directory: watchedDir };
    } else {
      console.log('[IPC] No previous folder found to load');
      return { success: false, error: 'No previous folder found' };
    }
  })

  // Terminal IPC handlers
  ipcMain.handle('terminal:spawn', async (event, nodeMetadata) => {
    console.log('[MAIN] terminal:spawn IPC called, event.sender.id:', event.sender.id)
    const result = await deps.terminalManager.spawn(
      event.sender,
      nodeMetadata,
      () => getWatchedDirectory(),
      deps.getToolsDirectory
    )
    console.log('[MAIN] terminal:spawn result:', result)
    return result
  })

  ipcMain.handle('terminal:write', async (_event, terminalId, data) => {
    return deps.terminalManager.write(terminalId, data)
  })

  ipcMain.handle('terminal:resize', async (_event, terminalId, cols, rows) => {
    return deps.terminalManager.resize(terminalId, cols, rows)
  })

  ipcMain.handle('terminal:kill', async (_event, terminalId) => {
    return deps.terminalManager.kill(terminalId)
  })

  // Position management IPC handlers
  ipcMain.handle('positions:save', async (_event, directoryPath, positions) => {
    await deps.positionManager.savePositions(directoryPath, positions)
    return { success: true }
  })

  ipcMain.handle('positions:load', async (_event, directoryPath) => {
    const positions = await deps.positionManager.loadPositions(directoryPath)
    return { success: true, positions }
  })
}
