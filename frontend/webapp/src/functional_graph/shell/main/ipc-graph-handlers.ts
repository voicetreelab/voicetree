import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { GraphDelta } from '@/functional_graph/pure/types'
import { getGraph } from '@/functional_graph/shell/state/graph-store.ts'
import { applyGraphDeltaToStateAndUI } from "@/functional_graph/shell/main/applyGraphDeltaToStateAndUI.ts"
import { loadFolder, stopWatching, isWatching, getWatchedDirectory } from '@/functional_graph/shell/main/watchFolder.ts'
import fs from 'fs'
import type TerminalManager from '@/electron/terminal-manager.ts'
import type PositionManager from '@/electron/position-manager.ts'

interface IpcHandlerDependencies {
  readonly terminalManager: TerminalManager
  readonly positionManager: PositionManager
  readonly getBackendPort: () => number | null
  readonly getToolsDirectory: () => string
}

export function registerAllIpcHandlers(deps: IpcHandlerDependencies) {
  // GRAPH UPDATE - handles all node actions (create, update, delete)
  ipcMain.handle('graph:applyDelta', async (_event, action: GraphDelta) => {
    const window = BrowserWindow.fromWebContents(_event.sender)
    if (window) {
      applyGraphDeltaToStateAndUI(action, window)
    }
  })

  // QUERY GRAPH STATE
  ipcMain.handle('graph:getState', async () => {
    return {
      success: true,
      graph: getGraph()
    }
  })

  // Backend server port
  ipcMain.handle('get-backend-port', () => {
    return deps.getBackendPort()
  })

  // File watching handlers
  ipcMain.handle('start-file-watching', async (_event, directoryPath) => {
    // Get selected directory (either from param or via dialog)
    const getDirectory = async (): Promise<string | null> => {
      if (directoryPath) {
        return directoryPath
      }

      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Directory to Watch for Markdown Files',
        buttonLabel: 'Watch Directory'
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return result.filePaths[0]
    }

    const selectedDirectory = await getDirectory()

    if (!selectedDirectory) {
      return { success: false, error: 'No directory selected' }
    }

    // FAIL FAST: Validate directory exists before proceeding
    if (!fs.existsSync(selectedDirectory)) {
      const error = `Directory does not exist: ${selectedDirectory}`
      console.error('[IPC] start-file-watching failed:', error)
      return { success: false, error }
    }

    if (!fs.statSync(selectedDirectory).isDirectory()) {
      const error = `Path is not a directory: ${selectedDirectory}`
      console.error('[IPC] start-file-watching failed:', error)
      return { success: false, error }
    }

    return await loadFolder(selectedDirectory)
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
