import { ipcMain } from 'electron'
import { apply_graph_deltas } from '@/functional_graph/pure/applyGraphActionsToDB'
import type {Graph, GraphDelta, Env, NodeDelta} from '@/functional_graph/pure/types'
import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import { getGraph, setGraph, getVaultPath } from '@/functional_graph/shell/state/graph-store.ts'

/**
 * IPC handlers for user-initiated graph actions.
 *
 * This module wires user actions from the renderer to the functional graph core.
 * It follows the functional pattern with Reader monad:
 * 1. Get current graph state (via getter)
 * 2. Apply action to get ReaderTaskEither effect (pure function)
 * 3. Execute effect by providing environment (ONLY writes to filesystem)
 * 4. File watch handlers detect the change and update graph state
 *
 * IMPORTANT: These handlers do NOT update graph state directly.
 * Filesystem is the single source of truth - all graph updates flow through file watch handlers.
 *
 * Handlers are auto-registered at module load and read from global state.
 */

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
            console.error(`[IPC] Error handling ${action.type}:`, result.left)
            return {
                success: false,
                error: result.left.message
            }
        }

        // Success - filesystem write completed
        // Graph state update will come from file watch handlers
        return {success: true}
    } catch (error) {
        console.error(`[IPC] Error handling ${action.type}:`, error)
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
// TODO DON"T ACTUALLY NEED THIS (?)
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
