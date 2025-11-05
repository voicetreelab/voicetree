import { contextBridge, ipcRenderer } from 'electron';
import type {Graph, GraphDelta} from "@/functional_graph/pure/types.ts";
import type { ElectronAPI } from '@/types/electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const electronAPI: ElectronAPI = {
  // Backend server configuration
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),

  // File watching controls
  startFileWatching: (directoryPath) => ipcRenderer.invoke('start-file-watching', directoryPath),
  stopFileWatching: () => ipcRenderer.invoke('stop-file-watching'),
  getWatchStatus: () => ipcRenderer.invoke('get-watch-status'),

  // File watching event listeners
  onWatchingStarted: (callback) => {
    ipcRenderer.on('watching-started', (event, data) => callback(data));
  },
  onInitialFilesLoaded: (callback) => {
    ipcRenderer.on('initial-files-loaded', (event, data) => callback(data));
  },
  onFileAdded: (callback) => {
    ipcRenderer.on('file-added', (event, data) => callback(data));
  },
  onFileChanged: (callback) => {
    ipcRenderer.on('file-changed', (event, data) => callback(data));
  },
  onFileDeleted: (callback) => {
    ipcRenderer.on('file-deleted', (event, data) => callback(data));
  },
  onDirectoryAdded: (callback) => {
    ipcRenderer.on('directory-added', (event, data) => callback(data));
  },
  onDirectoryDeleted: (callback) => {
    ipcRenderer.on('directory-deleted', (event, data) => callback(data));
  },
  onInitialScanComplete: (callback) => {
    ipcRenderer.on('initial-scan-complete', (event, data) => callback(data));
  },
  onFileWatchError: (callback) => {
    ipcRenderer.on('file-watch-error', (event, data) => callback(data));
  },
  onFileWatchInfo: (callback) => {
    ipcRenderer.on('file-watch-info', (event, data) => callback(data));
  },
  onFileWatchingStopped: (callback) => {
    ipcRenderer.on('file-watching-stopped', (event, data) => callback(data));
  },

  // Remove event listeners (cleanup)
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // File content management
  saveFileContent: (filePath, content) => ipcRenderer.invoke('save-file-content', filePath, content),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  createChildNode: (parentNodeId) => ipcRenderer.invoke('create-child-node', parentNodeId),
  createStandaloneNode: (position?: { x: number; y: number }) => ipcRenderer.invoke('create-standalone-node', position),

  // Terminal API
  terminal: {
    spawn: (nodeMetadata) => ipcRenderer.invoke('terminal:spawn', nodeMetadata),
    write: (terminalId, data) => ipcRenderer.invoke('terminal:write', terminalId, data),
    resize: (terminalId, cols, rows) => ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
    kill: (terminalId) => ipcRenderer.invoke('terminal:kill', terminalId),
    onData: (callback) => {
      ipcRenderer.on('terminal:data', (event, terminalId, data) => callback(terminalId, data));
    },
    onExit: (callback) => {
      ipcRenderer.on('terminal:exit', (event, terminalId, code) => callback(terminalId, code));
    }
  },

  // Position management API
  positions: {
    save: (directoryPath, positions) => ipcRenderer.invoke('positions:save', directoryPath, positions),
    load: (directoryPath) => ipcRenderer.invoke('positions:load', directoryPath)
  },

  // Backend log streaming
  onBackendLog: (callback) => {
    ipcRenderer.on('backend-log', (event, log) => callback(log));
  },

  // Functional graph API (Phase 3)
  graph: {
    // Action dispatcher - send any node action to main process
    applyGraphDelta: (action: GraphDelta) => ipcRenderer.invoke('graph:applyDelta', action),

    // Query current graph state
    getState: () : Promise<Graph> => ipcRenderer.invoke('graph:getState'),

    // Subscribe to graph state broadcasts
    onStateChanged: (callback) => {
      const listener = (event, graph) => callback(graph);
      ipcRenderer.on('graph:stateChanged', listener);
      // Return cleanup function
      return () => {
        ipcRenderer.off('graph:stateChanged', listener);
      };
    }
  },

  // General IPC communication methods
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void) => ipcRenderer.on(channel, listener),
  off: (channel: string, listener: (...args: unknown[]) => void) => ipcRenderer.off(channel, listener)
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);