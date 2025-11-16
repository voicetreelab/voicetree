import {applyGraphDeltaToDBAndMem} from './graph/writePath/applyGraphDeltaToDBAndMem.ts'
import {getGraph} from '@/shell/edge/main/state/graph-store.ts'
import {loadSettings, saveSettings as saveSettings} from './settings/settings_IO.ts'
import {getWatchStatus, loadPreviousFolder, startFileWatching, stopFileWatching} from './graph/watchFolder.ts'
import {getBackendPort} from "@/shell/edge/main/state/app-electron-state.ts";

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
