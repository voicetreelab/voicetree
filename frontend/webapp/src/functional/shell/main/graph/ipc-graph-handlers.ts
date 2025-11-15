import { ipcMain } from 'electron'
import type TerminalManager from '@/electron/terminal-manager.ts'
import { getWatchedDirectory } from '@/functional/shell/main/graph/watchFolder.ts'
import { mainAPI } from '@/functional/shell/main/api.ts'
import type { PositionData } from '@/electron/position-manager.ts'

// Import dependencies directly - functional programming style
// terminalManager and getToolsDirectory will be passed as parameters since terminal handlers need event.sender
export function registerAllIpcHandlers(
  terminalManager: TerminalManager,
  getToolsDirectory: () => string
) {

    //todo need to migrate these to new auto function system.

    // ============================================================================
  // File watching handlers - delegate to mainAPI
  // ============================================================================

  ipcMain.handle('start-file-watching', async (_event, directoryPath?: string) => {
    return mainAPI.startFileWatching(directoryPath)
  })

  ipcMain.handle('stop-file-watching', async () => {
    return mainAPI.stopFileWatching()
  })

  ipcMain.handle('get-watch-status', () => {
    return mainAPI.getWatchStatus()
  })

  ipcMain.handle('load-previous-folder', async () => {
    return mainAPI.loadPreviousFolder()
  })

  // ============================================================================
  // Backend port handler - delegate to mainAPI
  // ============================================================================

  ipcMain.handle('get-backend-port', () => {
    return mainAPI.getBackendPort()
  })

  // ============================================================================
  // Position handlers - delegate to mainAPI
  // ============================================================================

  ipcMain.handle('positions:save', async (_event, directoryPath: string, positions: PositionData) => {
    return mainAPI.savePositions(directoryPath, positions)
  })

  ipcMain.handle('positions:load', async (_event, directoryPath: string) => {
    return mainAPI.loadPositions(directoryPath)
  })

  // ============================================================================
  // Terminal IPC handlers - kept here since they need event.sender
  // ============================================================================

  ipcMain.handle('terminal:spawn', async (event, nodeMetadata) => {
    console.log('[MAIN] terminal:spawn IPC called, event.sender.id:', event.sender.id)
    const result = await terminalManager.spawn(
      event.sender,
      nodeMetadata,
      () => getWatchedDirectory(),
      getToolsDirectory
    )
    console.log('[MAIN] terminal:spawn result:', result)
    return result
  })

  ipcMain.handle('terminal:write', async (_event, terminalId, data) => {
    return terminalManager.write(terminalId, data)
  })

  ipcMain.handle('terminal:resize', async (_event, terminalId, cols, rows) => {
    return terminalManager.resize(terminalId, cols, rows)
  })

  ipcMain.handle('terminal:kill', async (_event, terminalId) => {
    return terminalManager.kill(terminalId)
  })
}
