import {applyGraphDeltaToDBAndMem} from './graph/writePath/applyGraphDeltaToDBAndMem.ts'
import {getGraph} from '@/functional/shell/state/graph-store'
import {loadSettings, saveSettings as saveSettings} from './settings/settings_IO'
import {getWatchStatus, loadPreviousFolder, startFileWatching, stopFileWatching} from './graph/watchFolder'
import {getBackendPort} from "@/functional/shell/state/app-electron-state.ts";

export const mainAPI = {
  // Graph operations - renderer-friendly wrappers
  applyGraphDeltaToDBAndMem,

  getGraph,

  // Settings operations
  loadSettings,

  saveSettings,

  // File watching operations - thin wrappers
  startFileWatching,

  stopFileWatching,

  getWatchStatus,

  loadPreviousFolder,

  // Backend port
  getBackendPort,
}
