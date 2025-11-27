import {applyGraphDeltaToDBThroughMem} from './graph/writePath/applyGraphDeltaToDBThroughMem'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {loadSettings, saveSettings as saveSettings} from './settings/settings_IO'
import {getWatchStatus, loadPreviousFolder, startFileWatching, stopFileWatching} from './graph/watchFolder'
import {getBackendPort} from "@/shell/edge/main/state/app-electron-state";
import {createContextNode} from "@/shell/edge/main/graph/createContextNode";
import {app} from 'electron';

/** Get the VoiceTree Application Support directory path */
function getAppSupportPath(): string {
  return app.getPath('userData');
}

// eslint-disable-next-line @typescript-eslint/typedef
export const mainAPI = {
  // Graph operations - renderer-friendly wrappers
  applyGraphDeltaToDBThroughMem,

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

  createContextNode,

  // App paths
  getAppSupportPath,
}
