// todo this needs to be cleaned up, use similar pattern to main -> render


import {contextBridge, ipcRenderer} from 'electron';
import type {GraphDelta} from "@/functional/pure/graph/types.ts";
import type {ElectronAPI} from '@/types/electron';
import type {mainAPI} from '@/functional/shell/main/api';

// Async function to build and expose the electronAPI
// This allows us to dynamically fetch API keys from main process at runtime
async function exposeElectronAPI(): Promise<void> {
    // Step 1: Fetch API keys from main process
    const apiKeys = await ipcRenderer.invoke('rpc:getApiKeys') as string[]

    // Step 2: Build RPC wrappers dynamically (zero-boilerplate: just add to mainAPI)
    const mainAPIWrappers: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    for (const key of apiKeys) {
        mainAPIWrappers[key] = (...args: unknown[]) => ipcRenderer.invoke('rpc:call', key, args)
    }

    // Step 3: Build electronAPI with dynamically generated wrappers
    const electronAPI: ElectronAPI = {
        // Zero-boilerplate RPC pattern - automatic type inference from mainAPI
        main: mainAPIWrappers as typeof mainAPI,
        // Backend server configuration
        getBackendPort: () => ipcRenderer.invoke('get-backend-port'),

        // Directory selection
        openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),

        // File watching controls
        startFileWatching: (directoryPath) => ipcRenderer.invoke('start-file-watching', directoryPath),
        stopFileWatching: () => ipcRenderer.invoke('stop-file-watching'),
        getWatchStatus: () => ipcRenderer.invoke('get-watch-status'),
        loadPreviousFolder: () => ipcRenderer.invoke('load-previous-folder'),

        // File watching event listeners
        onWatchingStarted: (callback) => {
            ipcRenderer.on('watching-started', (_event, data) => callback(data));
        },
        onInitialFilesLoaded: (callback) => {
            ipcRenderer.on('initial-files-loaded', (_event, data) => callback(data));
        },
        onFileAdded: (callback) => {
            ipcRenderer.on('file-added', (_event, data) => callback(data));
        },
        onFileChanged: (callback) => {
            ipcRenderer.on('file-changed', (_event, data) => callback(data));
        },
        onFileDeleted: (callback) => {
            ipcRenderer.on('file-deleted', (_event, data) => callback(data));
        },
        onDirectoryAdded: (callback) => {
            ipcRenderer.on('directory-added', (_event, data) => callback(data));
        },
        onDirectoryDeleted: (callback) => {
            ipcRenderer.on('file-watching-stopped', (_event, data) => callback(data));
        },
        onInitialScanComplete: (callback) => {
            ipcRenderer.on('initial-scan-complete', (_event, data) => callback(data));
        },
        onFileWatchError: (callback) => {
            ipcRenderer.on('file-watch-error', (_event, data) => callback(data));
        },
        onFileWatchInfo: (callback) => {
            ipcRenderer.on('file-watch-info', (_event, data) => callback(data));
        },
        onFileWatchingStopped: (callback) => {
            ipcRenderer.on('file-watching-stopped', (_event, data) => callback(data));
        },

        // Remove event listeners (cleanup)
        removeAllListeners: (channel) => {
            ipcRenderer.removeAllListeners(channel);
        },

        // File content management
        saveFileContent: (filePath, content) => ipcRenderer.invoke('save-file-content', filePath, content),
        deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
        createChildNode: (parentNodeId) => ipcRenderer.invoke('create-child-node', parentNodeId),
        createStandaloneNode: (position?: {
            x: number;
            y: number
        }) => ipcRenderer.invoke('create-standalone-node', position),

        // Terminal API
        terminal: {
            spawn: (nodeMetadata) => ipcRenderer.invoke('terminal:spawn', nodeMetadata),
            write: (terminalId, data) => ipcRenderer.invoke('terminal:write', terminalId, data),
            resize: (terminalId, cols, rows) => ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
            kill: (terminalId) => ipcRenderer.invoke('terminal:kill', terminalId),
            onData: (callback) => {
                ipcRenderer.on('terminal:data', (_event, terminalId, data) => callback(terminalId, data));
            },
            onExit: (callback) => {
                ipcRenderer.on('terminal:exit', (_event, terminalId, code) => callback(terminalId, code));
            }
        },

        // Position management API
        positions: {
            save: (directoryPath, positions) => ipcRenderer.invoke('positions:save', directoryPath, positions),
            load: (directoryPath) => ipcRenderer.invoke('positions:load', directoryPath)
        },


        // Backend log streaming
        onBackendLog: (callback) => {
            ipcRenderer.on('backend-log', (_event, log) => callback(log));
        },

        // Functional graph API (Phase 3)
        graph: {
            // Subscribe to graph delta updates (returns unsubscribe function)
            onGraphUpdate: (callback: (delta: GraphDelta) => void) => {
                const handler = (_event: unknown, delta: GraphDelta) => callback(delta);
                ipcRenderer.on('graph:stateChanged', handler);
                return () => ipcRenderer.off('graph:stateChanged', handler);
            },

            // Subscribe to graph clear events (returns unsubscribe function)
            onGraphClear: (callback: () => void) => {
                const handler = () => callback();
                ipcRenderer.on('graph:clear', handler);
                return () => ipcRenderer.off('graph:clear', handler);
            }
        },

        // General IPC communication methods
        invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
        on: (channel: string, listener: (...args: unknown[]) => void) => ipcRenderer.on(channel, listener),
        off: (channel: string, listener: (...args: unknown[]) => void) => ipcRenderer.off(channel, listener)
    }

    // Step 4: Expose the API to the renderer
    contextBridge.exposeInMainWorld('electronAPI', electronAPI)
}

// Initialize the API
exposeElectronAPI().catch((error: unknown) => {
    console.error('[Preload] FATAL ERROR: Failed to expose electronAPI:', error)
})