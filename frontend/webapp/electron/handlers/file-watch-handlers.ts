import { BrowserWindow } from 'electron'
import { apply_db_updates_to_graph } from '@/graph-core/functional/apply-db-updates'
import type { Graph, FSUpdate } from '@/graph-core/functional/types'
import type FileWatchManager from 'electron/file-watch-manager'

/**
 * Setup file watch handlers for filesystem changes.
 *
 * This module intercepts file system events from FileWatchManager and applies them
 * to the functional graph. It follows the functional pattern:
 * 1. FileWatchManager detects filesystem change
 * 2. We intercept the event before it goes to renderer
 * 3. Apply update to get new graph + UI effect (pure function)
 * 4. Update graph state (via setter)
 * 5. Execute UI effect (broadcast to renderer)
 *
 * @param fileWatchManager - The existing FileWatchManager instance
 * @param getGraph - Function to get current graph state
 * @param setGraph - Function to update graph state
 * @param mainWindow - BrowserWindow for broadcasting updates
 */
export function setupFileWatchHandlers(
  fileWatchManager: FileWatchManager,
  getGraph: () => Graph,
  setGraph: (graph: Graph) => void,
  mainWindow: BrowserWindow
): void {
  // Create broadcast function for UI updates
  const broadcast = (graph: Graph) => {
    mainWindow.webContents.send('graph:stateChanged', graph)
  }

  // Create curried apply function with broadcast injected
  const applyUpdate = apply_db_updates_to_graph(broadcast)

  // Hook into FileWatchManager's internal event system by wrapping sendToRenderer
  const originalSendToRenderer = (fileWatchManager as any).sendToRenderer.bind(fileWatchManager)

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
        const [newGraph, uiEffect] = applyUpdate(currentGraph, fsUpdate)

        setGraph(newGraph) // Update cache
        uiEffect() // Broadcast to renderer
      } else if (channel === 'file-changed' && data?.fullPath && data?.content) {
        const fsUpdate: FSUpdate = {
          path: data.fullPath,
          content: data.content,
          eventType: 'Changed'
        }

        const currentGraph = getGraph()
        const [newGraph, uiEffect] = applyUpdate(currentGraph, fsUpdate)

        setGraph(newGraph) // Update cache
        uiEffect() // Broadcast to renderer
      } else if (channel === 'file-deleted' && data?.fullPath) {
        const fsUpdate: FSUpdate = {
          path: data.fullPath,
          content: '',
          eventType: 'Deleted'
        }

        const currentGraph = getGraph()
        const [newGraph, uiEffect] = applyUpdate(currentGraph, fsUpdate)

        setGraph(newGraph) // Update cache
        uiEffect() // Broadcast to renderer
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
