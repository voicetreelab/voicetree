// todo this needs to be cleaned up, use similar pattern to main -> render


import {contextBridge, ipcRenderer} from 'electron';
import type {GraphDelta} from "@/pure/graph";
import type {ElectronAPI, Promisify} from '@/utils/types/electron';

// Async function to build and expose the electronAPI
// This allows us to dynamically fetch API keys from main process at runtime
async function exposeElectronAPI(): Promise<void> {
    // Step 1: Fetch API keys from main process
    const apiKeys = await ipcRenderer.invoke('rpc:getApiKeys') as string[]

    // Step 2: Build RPC wrappers dynamically (zero-boilerplate: just add to mainAPI)
    const mainAPIWrappers: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    for (const key of apiKeys) {
        mainAPIWrappers[key] = (...args: unknown[]) => ipcRenderer.invoke('rpc:call', key, args)
    } // see rpc-handler.ts

    // Step 3: Build electronAPI with dynamically generated wrappers
    const electronAPI: ElectronAPI = {
        // Zero-boilerplate RPC pattern - automatic type inference from mainAPI
        main: mainAPIWrappers as unknown as Promisify<MainAPI>,

        // Directory selection
        // openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),

        // File watching event listeners
        onWatchingStarted: (callback) => {
            ipcRenderer.on('watching-started', (_event, data) => callback(data));
        },
        onFileWatchingStopped: (callback) => {
            ipcRenderer.on('file-watching-stopped', (_event, data) => callback(data));
        },

        // Remove event listeners (cleanup)
        removeAllListeners: (channel) => {
            ipcRenderer.removeAllListeners(channel);
        },

        // Terminal API
        terminal: {
            spawn: (terminalData) => ipcRenderer.invoke('terminal:spawn', terminalData),
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