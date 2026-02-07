// =============================================================================
// STOP! Before adding custom IPC handlers here, use the zero-boilerplate RPC patterns:
//
// RENDERER → MAIN (request/response):
//   1. Add your function to mainAPI in src/shell/edge/main/api.ts
//   2. Call it via window.electronAPI.main.yourFunction() - types flow automatically
//   See: src/shell/edge/main/edge-auto-rpc/rpc-handler.ts
//
// MAIN → RENDERER (push events):
//   1. Add your function to uiAPIHandler in src/shell/edge/UI-edge/api.ts
//   2. Call it from main via uiAPI.yourFunction() - types flow automatically
//   See: src/shell/edge/main/ui-api-proxy.ts, src/shell/edge/UI-edge/ui-rpc-handler.ts
//
// Only add custom handlers here for complex patterns that don't fit the above
// (e.g., graph.onGraphUpdate which returns an unsubscribe function).
// =============================================================================

import {contextBridge, ipcRenderer} from 'electron';
import type {GraphDelta} from "@/pure/graph";
import type {ElectronAPI, Promisify} from '@/shell/electron';
import type {mainAPI} from '@/shell/edge/main/api';

// Async function to build and expose the electronAPI
// This allows us to dynamically fetch API keys from main process at runtime
async function exposeElectronAPI(): Promise<void> {
    // Step 1: Fetch API keys from main process
    const apiKeys: string[] = await ipcRenderer.invoke('rpc:getApiKeys') as string[]

    // Step 2: Build RPC wrappers dynamically (zero-boilerplate: just add to mainAPI)
    const mainAPIWrappers: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    for (const key of apiKeys) {
        mainAPIWrappers[key] = (...args: unknown[]) => ipcRenderer.invoke('rpc:call', key, args)
    } // see rpc-handler.ts

    // Step 3: Build electronAPI with dynamically generated wrappers
    const electronAPI: ElectronAPI = {
        // Zero-boilerplate RPC pattern - automatic type inference from mainAPI
        main: mainAPIWrappers as unknown as Promisify<typeof mainAPI>,

        // Directory selection
        // openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),

        // File watching event listeners (returns cleanup function like onGraphUpdate)
        onWatchingStarted: (callback) => {
            type WatchingStartedData = { directory: string; timestamp: string; positions?: Record<string, { x: number; y: number }> };
            const handler: (_event: Electron.IpcRendererEvent, data: WatchingStartedData) => void = (_event, data) => callback(data);
            ipcRenderer.on('watching-started', handler);
            return () => ipcRenderer.off('watching-started', handler);
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
                const handler: (_event: unknown, delta: GraphDelta) => void = (_event: unknown, delta: GraphDelta) => callback(delta);
                ipcRenderer.on('graph:stateChanged', handler);
                return () => ipcRenderer.off('graph:stateChanged', handler);
            },

            // Subscribe to graph clear events (returns unsubscribe function)
            onGraphClear: (callback: () => void) => {
                const handler: () => void = () => callback();
                ipcRenderer.on('graph:clear', handler);
                return () => ipcRenderer.off('graph:clear', handler);
            }
        },

        // General IPC communication methods - SECURITY: Restricted to allowlist
        // These generic methods are kept for backwards compatibility but restricted to safe channels
        invoke: (channel: string, ...args: unknown[]) => {
            // Security: Only allow specific IPC channels to prevent XSS escalation to RCE
            const ALLOWED_INVOKE_CHANNELS = new Set([
                'rpc:call',
                'rpc:getApiKeys',
                'terminal:spawn',
                'terminal:write',
                'terminal:resize',
                'terminal:kill',
            ]);
            if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
                console.error(`[Preload] SECURITY: Blocked invoke to unauthorized channel: ${channel}`);
                return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
            }
            return ipcRenderer.invoke(channel, ...args);
        },
        on: (channel: string, listener: (...args: unknown[]) => void) => {
            // Security: Only allow subscribing to specific event channels
            const ALLOWED_ON_CHANNELS = new Set([
                'terminal:data',
                'terminal:exit',
                'backend-log',
                'graph:stateChanged',
                'graph:clear',
                'watching-started',
            ]);
            if (!ALLOWED_ON_CHANNELS.has(channel)) {
                console.error(`[Preload] SECURITY: Blocked subscription to unauthorized channel: ${channel}`);
                return;
            }
            return ipcRenderer.on(channel, listener);
        },
        off: (channel: string, listener: (...args: unknown[]) => void) => {
            // Security: Match the same allowlist as 'on'
            const ALLOWED_OFF_CHANNELS = new Set([
                'terminal:data',
                'terminal:exit',
                'backend-log',
                'graph:stateChanged',
                'graph:clear',
                'watching-started',
            ]);
            if (!ALLOWED_OFF_CHANNELS.has(channel)) {
                console.error(`[Preload] SECURITY: Blocked unsubscribe from unauthorized channel: ${channel}`);
                return;
            }
            return ipcRenderer.off(channel, listener);
        }
    }

    // Step 4: Expose the API to the renderer
    contextBridge.exposeInMainWorld('electronAPI', electronAPI)
}

// Initialize the API
exposeElectronAPI().catch((error: unknown) => {
    console.error('[Preload] FATAL ERROR: Failed to expose electronAPI:', error)
})

// E2E Test Mode: Expose flag for mock speech client injection
// Set by Playwright tests via env var when launching Electron
if (process.env.E2E_SPEECH_MOCK === 'true') {
    contextBridge.exposeInMainWorld('__E2E_TEST__', true)
}