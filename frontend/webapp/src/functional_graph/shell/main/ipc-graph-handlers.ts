import { ipcMain } from 'electron'
import { apply_graph_deltas } from '@/functional_graph/pure/applyGraphActionsToDB'
import type {GraphDelta, Env, NodeDelta} from '@/functional_graph/pure/types'
import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import { getGraph, getVaultPath } from '@/functional_graph/shell/state/graph-store.ts'

async function applyDelta(action: readonly NodeDelta[]) {
    try {
        // Get vault path from Option
        const vaultPathOption = getVaultPath()
        if (O.isNone(vaultPathOption)) {
            return {
                success: false,
                error: 'No vault path set - cannot apply graph delta'
            }
        }

        // Construct environment for filesystem write
        const env: Env = {
            vaultPath: vaultPathOption.value,
        }

        // Create Reader effect (pure - no execution yet)
        const effect = apply_graph_deltas(getGraph(), action)

        // Execute effect - this ONLY writes to filesystem
        // File watch handlers will detect the change and update graph state
        const result = await effect(env)()

        if (E.isLeft(result)) {
            console.error(`[IPC] Error handling applydelta`, result.left)
            return {
                success: false,
                error: result.left.message
            }
        }

        // Success - filesystem write completed
        // Graph state update will come from file watch handlers
        return {success: true}
    } catch (error) {
        console.error(`[IPC] Error handling applyDelta:`, error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    }
}

// GRAPH UPDATE - handles all node actions (create, update, delete)
ipcMain.handle('graph:applyDelta', async (_event, action: GraphDelta) => {
    return await applyDelta(action);
})

// QUERY GRAPH STATE
ipcMain.handle('graph:getState', async () => {
  try {
    return {
      success: true,
      graph: getGraph()
    }
  } catch (error) {
    console.error('[IPC] Error getting graph state:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

console.log('[IPC] Graph handlers registered')
