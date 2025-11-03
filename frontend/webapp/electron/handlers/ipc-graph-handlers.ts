import { ipcMain } from 'electron'
import { apply_graph_updates } from '@/graph-core/functional/apply-graph-updates'
import type { Graph, CreateNode, UpdateNode, DeleteNode } from '@/graph-core/functional/types'

/**
 * Setup IPC handlers for user-initiated graph actions.
 *
 * This module wires user actions from the renderer to the functional graph core.
 * It follows the functional pattern:
 * 1. Get current graph state (via getter)
 * 2. Apply action to get new graph + DB effect (pure function)
 * 3. Execute DB effect (write to filesystem)
 * 4. Update graph state (via setter)
 *
 * @param getGraph - Function to get current graph state
 * @param setGraph - Function to update graph state
 * @param vaultPath - Path to the vault directory for filesystem operations
 */
export function setupGraphIpcHandlers(
  getGraph: () => Graph,
  setGraph: (graph: Graph) => void,
  vaultPath: string
): void {
  // Create curried apply function with vaultPath injected
  const applyUpdate = apply_graph_updates(vaultPath)

  // CREATE NODE
  ipcMain.handle('graph:createNode', async (_event, action: CreateNode) => {
    try {
      const currentGraph = getGraph()
      const [newGraph, dbEffect] = applyUpdate(currentGraph, action)

      await dbEffect() // Write to filesystem
      setGraph(newGraph) // Update cache

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
      const [newGraph, dbEffect] = applyUpdate(currentGraph, action)

      await dbEffect() // Write to filesystem
      setGraph(newGraph) // Update cache

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
      const [newGraph, dbEffect] = applyUpdate(currentGraph, action)

      await dbEffect() // Delete from filesystem
      setGraph(newGraph) // Update cache

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
