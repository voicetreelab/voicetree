import { ipcMain } from 'electron'

import { getCurrentProjectedGraphFromDaemon } from './daemon-ipc-proxy'

export function registerGraphIpcHandlers(): void {
  ipcMain.handle('graph:getCurrentProjectedGraph', async () =>
    await getCurrentProjectedGraphFromDaemon(),
  )
}
