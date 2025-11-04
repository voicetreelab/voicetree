import { ipcMain } from 'electron'
import { apply_graph_updates } from '@/functional_graph/pure/applyGraphActionsToDB'
import type { Graph, NodeAction, Env } from '@/functional_graph/pure/types'
import * as E from 'fp-ts/lib/Either.js'
import { getGraph, setGraph, getVaultPath, getMainWindow } from '../main'

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

// GRAPH UPDATE - handles all node actions (create, update, delete)
ipcMain.handle('graph:update', async (_event, action: NodeAction) => {
  try {
    const currentGraph = getGraph()

    // Construct environment for filesystem write
    const env: Env = {
      vaultPath: getVaultPath(),
      broadcast: () => {} // No-op: file watch handlers handle broadcasting
    }

    // Create Reader effect (pure - no execution yet)
    const effect = apply_graph_updates(currentGraph, action)

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
    return { success: true }
  } catch (error) {
    console.error(`[IPC] Error handling ${action.type}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

// QUERY GRAPH STATE
// TODO DON"T ACTUALLY NEED THIS
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
