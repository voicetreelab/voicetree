import { ipcMain } from 'electron'
import { mainAPI } from '@/shell/edge/main/api'

type MainAPIKey = keyof typeof mainAPI
type MainAPIFunction = (typeof mainAPI)[MainAPIKey]

export function setupRPCHandlers(): void {
  // Provide API keys to preload script for dynamic wrapper generation
  ipcMain.handle('rpc:getApiKeys', () => {
    return Object.keys(mainAPI)
  })

  ipcMain.handle('rpc:call', async (_event, fnName: string, args: readonly unknown[]): Promise<unknown> => {
    const fn: MainAPIFunction = mainAPI[fnName as MainAPIKey]

    if (typeof fn !== 'function') {
      return { error: `Function not found: ${fnName}` }
    }

    const result: unknown = (fn as (...args: readonly unknown[]) => unknown)(...args)
    return Promise.resolve(result)
      .catch((error: unknown) => {
        console.error(`[RPC Error] ${fnName}:`, error)
        return {
          error: `RPC call failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      })
  })
}
