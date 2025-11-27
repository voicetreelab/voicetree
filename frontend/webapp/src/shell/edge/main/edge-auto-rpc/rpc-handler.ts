import { ipcMain } from 'electron'
import { mainAPI } from '@/shell/edge/main/api'
import type { GraphDelta, Graph, NodeIdAndFilePath } from '@/pure/graph/index'
import type { VTSettings } from '@/pure/settings/types'

type MainAPIKey = keyof typeof mainAPI

export function setupRPCHandlers(): void {
  // Provide API keys to preload script for dynamic wrapper generation
  ipcMain.handle('rpc:getApiKeys', () => {
    return Object.keys(mainAPI)
  })

  ipcMain.handle('rpc:call', async (_event, fnName: string, args: readonly unknown[]): Promise<unknown> => {
    const fn: ((delta: GraphDelta) => Promise<void>) | (() => Graph) | (() => Promise<VTSettings>) | ((settings: VTSettings) => Promise<boolean>) | ((directoryPath?: string) => Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string; }>) | (() => Promise<{ readonly success: boolean; readonly error?: string; }>) | (() => { readonly isWatching: boolean; readonly directory: string | undefined; }) | (() => Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string; }>) | (() => number | null) | ((parentNodeId: NodeIdAndFilePath) => Promise<NodeIdAndFilePath>) | (() => string) = mainAPI[fnName as MainAPIKey]

    if (typeof fn !== 'function') {
      return { error: `Function not found: ${fnName}` }
    }

    const result: unknown = (fn as (...args: readonly unknown[]) => unknown)(...args)
    return Promise.resolve(result)
      .catch((error: unknown) => ({
        error: `RPC call failed: ${error instanceof Error ? error.message : String(error)}`,
      }))
  })
}
