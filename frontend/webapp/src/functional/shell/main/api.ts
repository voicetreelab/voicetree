import { applyGraphDeltaToDB } from './graph/writePath/applyGraphDeltaToDB'
import { getGraph } from '@/functional/shell/state/graph-store'
import { loadSettings, saveSettings as saveSettingsCore } from './settings/settings_IO'
import type { GraphDelta } from '@/functional/pure/graph/types'
import type { Settings } from '@/functional/pure/settings/types'
import { loadFolder, stopWatching, isWatching, getWatchedDirectory, initialLoad } from './graph/watchFolder'
import { dialog } from 'electron'
import fs from 'fs'
import type { PositionData } from '@/electron/position-manager'

// State management for dependencies that need to be injected from main.ts
// Using object reference that can be mutated internally while keeping const binding
const deps = {
  backendPort: null as number | null,
  positionManager: null as { readonly savePositions: (dir: string, pos: PositionData) => Promise<void>; readonly loadPositions: (dir: string) => Promise<PositionData> } | null
}

// Setter functions for main.ts to inject dependencies
export const setBackendPort = (port: number | null): void => {
  deps.backendPort = port
}

export const setPositionManager = (pm: { readonly savePositions: (dir: string, pos: PositionData) => Promise<void>; readonly loadPositions: (dir: string) => Promise<PositionData> }): void => {
  deps.positionManager = pm
}

export const mainAPI = {
  // Graph operations - renderer-friendly wrappers
  applyDelta: async (delta: GraphDelta): Promise<void> => {
    await applyGraphDeltaToDB(getGraph(), delta)
  },
  getGraphState: async () => getGraph(),

  // Settings operations
  loadSettings,
  saveSettings: async (settings: Settings): Promise<{ readonly success: boolean; readonly error?: string }> => {
    await saveSettingsCore(settings)
    return { success: true }
  },

  // File watching operations
  startFileWatching: async (directoryPath?: string): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> => {
    console.log('[mainAPI] startFileWatching called, directoryPath:', directoryPath)

    // Get selected directory (either from param or via dialog)
    const getDirectory = async (): Promise<string | null> => {
      if (directoryPath) {
        console.log('[mainAPI] Using provided directory path:', directoryPath)
        return directoryPath
      }

      console.log('[mainAPI] No directory provided, showing dialog...')

      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Directory to Watch for Markdown Files',
        buttonLabel: 'Watch Directory',
        defaultPath: getWatchedDirectory() || process.env.HOME || '/'
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return result.filePaths[0]
    }

    const selectedDirectory = await getDirectory()
    console.log('[mainAPI] Selected directory:', selectedDirectory)

    if (!selectedDirectory) {
      console.log('[mainAPI] No directory selected, returning error')
      return { success: false, error: 'No directory selected' }
    }

    // FAIL FAST: Validate directory exists before proceeding
    console.log('[mainAPI] Validating directory exists...')
    if (!fs.existsSync(selectedDirectory)) {
      const error = `Directory does not exist: ${selectedDirectory}`
      console.error('[mainAPI] startFileWatching failed:', error)
      return { success: false, error }
    }

    console.log('[mainAPI] Validating path is a directory...')
    if (!fs.statSync(selectedDirectory).isDirectory()) {
      const error = `Path is not a directory: ${selectedDirectory}`
      console.error('[mainAPI] startFileWatching failed:', error)
      return { success: false, error }
    }

    console.log('[mainAPI] Calling loadFolder...')
    await loadFolder(selectedDirectory)
    console.log('[mainAPI] loadFolder completed successfully')
    return { success: true, directory: selectedDirectory }
  },

  stopFileWatching: async (): Promise<{ readonly success: boolean }> => {
    await stopWatching()
    return { success: true }
  },

  getWatchStatus: (): { readonly isWatching: boolean; readonly directory: string | null } => {
    const status = {
      isWatching: isWatching(),
      directory: getWatchedDirectory()
    }
    console.log('Watch status:', status)
    return status
  },

  loadPreviousFolder: async (): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> => {
    console.log('[mainAPI] loadPreviousFolder called')
    await initialLoad()
    const watchedDir = getWatchedDirectory()
    if (watchedDir) {
      console.log('[mainAPI] Successfully loaded previous folder:', watchedDir)
      return { success: true, directory: watchedDir }
    } else {
      console.log('[mainAPI] No previous folder found to load')
      return { success: false, error: 'No previous folder found' }
    }
  },

  // Backend port
  getBackendPort: (): number | null => deps.backendPort,

  // Position operations
  savePositions: async (directoryPath: string, positions: PositionData): Promise<{ readonly success: boolean; readonly error?: string }> => {
    if (!deps.positionManager) {
      return { success: false, error: 'PositionManager not initialized' }
    }
    await deps.positionManager.savePositions(directoryPath, positions)
    return { success: true }
  },

  loadPositions: async (directoryPath: string): Promise<{ readonly success: boolean; readonly positions?: PositionData; readonly error?: string }> => {
    if (!deps.positionManager) {
      return { success: false, error: 'PositionManager not initialized' }
    }
    const positions = await deps.positionManager.loadPositions(directoryPath)
    return { success: true, positions }
  },
}
