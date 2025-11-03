import { BrowserWindow } from 'electron'
import { apply_db_updates_to_graph } from '@/functional_graph/pure/applyFSEventToGraph'
import type { Graph, FSUpdate, Env } from '@/functional_graph/pure/types'
import type FileWatchManager from 'electron/file-watch-manager'

/**
 * Setup file watch handlers for filesystem changes.
 *
 * This module intercepts file system events from FileWatchManager and applies them
 * to the functional graph. It follows the functional pattern with Reader monad:
 * 1. FileWatchManager detects filesystem change
 * 2. We intercept the event before it goes to renderer
 * 3. Apply update to get Reader effect (pure function)
 * 4. Execute effect by providing environment
 * 5. Update graph state (via setter)
 *
 * @param fileWatchManager - The existing FileWatchManager instance
 * @param getGraph - Function to get current graph state
 * @param setGraph - Function to update graph state
 * @param mainWindow - BrowserWindow for broadcasting updates
 * @param vaultPath - Path to the vault directory
 */
export function setupFileWatchHandlers(
  fileWatchManager: FileWatchManager,
  getGraph: () => Graph,
  setGraph: (graph: Graph) => void,
  mainWindow: BrowserWindow,
  vaultPath: string
): void {
  // Create broadcast function for UI updates
  const broadcast = (graph: Graph) => {
    mainWindow.webContents.send('graph:stateChanged', graph)
  }

  // Create environment object (contains all dependencies)
  const env: Env = {
    vaultPath,
    broadcast
  }

  // Hook into FileWatchManager's internal event system by wrapping sendToRenderer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalSendToRenderer = (fileWatchManager as any).sendToRenderer.bind(fileWatchManager)

  // eslint-disable-next-line no-param-reassign, @typescript-eslint/no-explicit-any
  ;(fileWatchManager as any).sendToRenderer = function (channel: string, data?: any) {
    // Intercept file events and update graph
    try {
      if (channel === 'file-added' && data?.fullPath && data?.content) {
        const fsUpdate: FSUpdate = {
          path: data.fullPath,
          content: data.content,
          eventType: 'Added'
        }

        const currentGraph = getGraph()

        // Create Reader effect (pure - no execution yet)
        const effect = apply_db_updates_to_graph(currentGraph, fsUpdate)

        // Execute by providing environment (synchronous Reader)
        const newGraph = effect(env)

        setGraph(newGraph) // Update cache
        env.broadcast(newGraph) // Broadcast in impure shell
      } else if (channel === 'file-changed' && data?.fullPath && data?.content) {
        const fsUpdate: FSUpdate = {
          path: data.fullPath,
          content: data.content,
          eventType: 'Changed'
        }

        const currentGraph = getGraph()

        // Create Reader effect (pure - no execution yet)
        const effect = apply_db_updates_to_graph(currentGraph, fsUpdate)

        // Execute by providing environment (synchronous Reader)
        const newGraph = effect(env)

        setGraph(newGraph) // Update cache
        env.broadcast(newGraph) // Broadcast in impure shell
      } else if (channel === 'file-deleted' && data?.fullPath) {
        const fsUpdate: FSUpdate = {
          path: data.fullPath,
          content: '',
          eventType: 'Deleted'
        }

        const currentGraph = getGraph()

        // Create Reader effect (pure - no execution yet)
        const effect = apply_db_updates_to_graph(currentGraph, fsUpdate)

        // Execute by providing environment (synchronous Reader)
        const newGraph = effect(env)

        setGraph(newGraph) // Update cache
        env.broadcast(newGraph) // Broadcast in impure shell
      } else if (channel === 'initial-files-loaded') {
        // For initial load, just broadcast current graph state
        const currentGraph = getGraph()
        broadcast(currentGraph)
      }
    } catch (error) {
      console.error('[FileWatch] Error updating graph:', error)
    }

    // Always call original to maintain existing behavior
    originalSendToRenderer(channel, data)
  }

  console.log('[FileWatch] Graph handlers registered')
}
