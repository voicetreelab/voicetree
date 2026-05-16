import { ipcMain } from 'electron'
import { mainAPI } from '@/shell/edge/main/runtime/api'

type NestedAPI = Record<string, unknown>

function flattenApiKeys(api: NestedAPI, prefix = ''): string[] {
  return Object.entries(api).flatMap(([k, v]) => {
    if (typeof v === 'function') return [prefix + k]
    if (v !== null && typeof v === 'object') return flattenApiKeys(v as NestedAPI, prefix + k + '.')
    return []
  })
}

function resolveNestedFn(api: NestedAPI, dotPath: string): ((...args: unknown[]) => unknown) | undefined {
  const result = dotPath.split('.').reduce<unknown>((obj, key) =>
    obj !== null && typeof obj === 'object' ? (obj as NestedAPI)[key] : undefined,
    api,
  )
  return typeof result === 'function' ? result as (...args: unknown[]) => unknown : undefined
}

export function setupRPCHandlers(): void {
  ipcMain.handle('rpc:getApiKeys', () =>
    flattenApiKeys(mainAPI as unknown as NestedAPI),
  )

  ipcMain.handle('rpc:call', async (_event, fnName: string, args: readonly unknown[]): Promise<unknown> => {
    const fn = resolveNestedFn(mainAPI as unknown as NestedAPI, fnName)

    if (typeof fn !== 'function') {
      throw new Error(`Function not found: ${fnName}`)
    }

    const result: unknown = fn(...args)
    return Promise.resolve(result)
      .catch((error: unknown) => {
        console.error(`[RPC Error] ${fnName}:`, error)
        throw error instanceof Error ? error : new Error(String(error))
      })
  })
}
