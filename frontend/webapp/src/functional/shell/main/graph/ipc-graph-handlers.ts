import { ipcMain } from 'electron'
import type TerminalManager from '@/electron/terminal-manager.ts'
import { getWatchedDirectory } from '@/functional/shell/main/graph/watchFolder.ts'

// Import dependencies directly - functional programming style
// terminalManager and getToolsDirectory will be passed as parameters since terminal handlers need event.sender
export function registerAllIpcHandlers(
  terminalManager: TerminalManager,
  getToolsDirectory: () => string
) {



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
