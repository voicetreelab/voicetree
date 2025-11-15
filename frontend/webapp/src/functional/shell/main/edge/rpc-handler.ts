import { ipcMain } from 'electron'
import { mainAPI } from '@/functional/shell/main/api'

type MainAPIKey = keyof typeof mainAPI

export function setupRPCHandlers(): void {
  // Provide API keys to preload script for dynamic wrapper generation
  ipcMain.handle('rpc:getApiKeys', () => {
    return Object.keys(mainAPI)
  })

  ipcMain.handle('rpc:call', async (_event, fnName: string, args: readonly unknown[]): Promise<unknown> => {
    const fn = mainAPI[fnName as MainAPIKey]

    if (typeof fn !== 'function') {
      return { error: `Function not found: ${fnName}` }
    }

    const result = (fn as (...args: readonly unknown[]) => unknown)(...args)
    return Promise.resolve(result)
      .catch((error: unknown) => ({
        error: `RPC call failed: ${error instanceof Error ? error.message : String(error)}`,
      }))
  })
}
