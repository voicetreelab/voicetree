import { ipcMain } from 'electron'
import { apply_graph_updates } from '@/functional_graph/pure/applyGraphActionsToDB'
import type { Graph, CreateNode, UpdateNode, DeleteNode, Env } from '@/functional_graph/pure/types'
import * as E from 'fp-ts/lib/Either.js'
import {AppEffect} from "../../src/functional_graph/pure/types";

/**
 * Setup IPC handlers for user-initiated graph actions.
 *
 * This module wires user actions from the renderer to the functional graph core.
 * It follows the functional pattern with Reader monad:
 * 1. Get current graph state (via getter)
 * 2. Apply action to get ReaderTaskEither effect (pure function)
 * 3. Execute effect by providing environment (write to filesystem)
 * 4. Update graph state (via setter)
 *
 * @param getGraph - Function to get current graph state
 * @param setGraph - Function to update graph state
 * @param vaultPath - Path to the vault directory for filesystem operations
 * @param broadcast - Function to broadcast graph updates to renderer
 */
export function setupGraphIpcHandlers(
  getGraph: () => Graph,
  setGraph: (graph: Graph) => void,
  vaultPath: string,
  broadcast: (graph: Graph) => void
): void {
  // Create environment object (contains all dependencies)
  const env: Env = {
    vaultPath,
    broadcast
  }

  // CREATE NODE
  ipcMain.handle('graph:createNode', async (_event, action: CreateNode) => {
    try {
      const currentGraph = getGraph()

      // Create Reader effect (pure - no execution yet)
      const effect : AppEffect<Graph> = apply_graph_updates(currentGraph, action)

      // Execute by providing environment
      // effect(env) - Reader execution (provide Env)
      // () - TaskEither execution (run async)
      const result = await effect(env)()
        // todo, how do we modify the env? env should have state that can be mutated right?

      if (E.isLeft(result)) {
        console.error('[IPC] Error handling createNode:', result.left)
        return {
          success: false,
          error: result.left.message
        }
      }

      // Update global state with new graph
      setGraph(result.right)

      // Broadcast graph update to renderer
      broadcast(result.right)

      return { success: true }
    } catch (error) {
      console.error('[IPC] Error handling createNode:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // UPDATE NODE
  ipcMain.handle('graph:updateNode', async (_event, action: UpdateNode) => {
    try {
      const currentGraph = getGraph()

      // Create Reader effect (pure - no execution yet)
      const effect = apply_graph_updates(currentGraph, action)

      // Execute by providing environment
      const result = await effect(env)()

      if (E.isLeft(result)) {
        console.error('[IPC] Error handling updateNode:', result.left)
        return {
          success: false,
          error: result.left.message
        }
      }

      // Update global state with new graph
      setGraph(result.right)

      // Broadcast graph update to renderer
      broadcast(result.right)

      return { success: true }
    } catch (error) {
      console.error('[IPC] Error handling updateNode:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // DELETE NODE
  ipcMain.handle('graph:deleteNode', async (_event, action: DeleteNode) => {
    try {
      const currentGraph = getGraph()

      // Create Reader effect (pure - no execution yet)
      const effect = apply_graph_updates(currentGraph, action)

      // Execute by providing environment
      const result = await effect(env)()

      if (E.isLeft(result)) {
        console.error('[IPC] Error handling deleteNode:', result.left)
        return {
          success: false,
          error: result.left.message
        }
      }

      // Update global state with new graph
      setGraph(result.right)

      // Broadcast graph update to renderer
      broadcast(result.right)

      return { success: true }
    } catch (error) {
      console.error('[IPC] Error handling deleteNode:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
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
}
