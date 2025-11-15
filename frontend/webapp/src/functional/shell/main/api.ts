import { applyGraphDeltaToDB } from './graph/writePath/applyGraphDeltaToDB'
import { getGraph } from '@/functional/shell/state/graph-store'
import { loadSettings, saveSettings as saveSettings } from './settings/settings_IO'
import {
  startFileWatching,
  stopFileWatchingAPI,
  getWatchStatusAPI,
  loadPreviousFolderAPI
} from './graph/watchFolder'

// eslint-disable-next-line functional/no-let
let backendPort: number | null = null;

// Setter functions for main.ts to inject dependencies
export const setBackendPort = (port: number | null): void => {
 backendPort = port
}

export const mainAPI = {
  // Graph operations - renderer-friendly wrappers
  applyGraphDeltaToDB,

  getGraph,

  // Settings operations
  loadSettings,

  saveSettings,

  // File watching operations - thin wrappers
  startFileWatching,

  stopFileWatching: stopFileWatchingAPI,

  getWatchStatus: getWatchStatusAPI,

  loadPreviousFolder: loadPreviousFolderAPI,

  // Backend port
  getBackendPort: (): number | null => backendPort,
}
