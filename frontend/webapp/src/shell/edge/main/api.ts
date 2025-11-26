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

export const mainAPI: { applyGraphDeltaToDBThroughMem: (delta: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphDelta) => Promise<void>; getGraph: () => import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph; loadSettings: () => Promise<import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/settings/types").VTSettings>; saveSettings: (settings: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/settings/types").VTSettings) => Promise<boolean>; startFileWatching: (directoryPath?: string) => Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string; }>; stopFileWatching: () => Promise<{ readonly success: boolean; readonly error?: string; }>; getWatchStatus: () => { readonly isWatching: boolean; readonly directory: string | undefined; }; loadPreviousFolder: () => Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string; }>; getBackendPort: () => number | null; createContextNode: (parentNodeId: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").NodeIdAndFilePath) => Promise<import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").NodeIdAndFilePath>; getAppSupportPath: () => string; } = {
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
