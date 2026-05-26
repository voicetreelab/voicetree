// =============================================================================
// STOP! Before adding custom IPC handlers here, use the zero-boilerplate RPC patterns:
//
// RENDERER → MAIN (request/response):
//   1. Add your function to mainAPI in src/shell/edge/main/runtime/api.ts
//   2. Call it via window.electronAPI.main.yourFunction() - types flow automatically
//   See: src/shell/edge/main/edge-auto-rpc/rpc-handler.ts
//
// MAIN → RENDERER (push events):
//   1. Add your function to uiAPIHandler in src/shell/edge/UI-edge/api.ts
//   2. Call it from main via uiAPI.yourFunction() - types flow automatically
//   See: src/shell/edge/main/runtime/ui-api-proxy.ts, src/shell/edge/UI-edge/ui-rpc-handler.ts
//
// Only add custom handlers here for complex patterns that don't fit the above
// (e.g., graph.onProjectedGraphUpdate which returns an unsubscribe function).
// =============================================================================

import {contextBridge, ipcRenderer} from 'electron';
import type {ProjectedGraph} from "@vt/graph-state/contract";
import type {ElectronAPI, Promisify} from '@/shell/electron';
import type {mainAPI} from '@/shell/edge/main/runtime/api';

// Synchronously expose runtime flags so the renderer can branch before
// async electronAPI setup finishes. PostHog init in main.tsx and other
// boot-time decisions need this without a roundtrip.
const perfMode: boolean =
    process.env.VOICETREE_PERF_MODE === '1'
    || process.env.NODE_ENV === 'test'
    || process.env.HEADLESS_TEST === '1';
contextBridge.exposeInMainWorld('voicetreeEnv', {perfMode});

// Async function to build and expose the electronAPI
// This allows us to dynamically fetch API keys from main process at runtime
async function exposeElectronAPI(): Promise<void> {
    // Step 1: Fetch API keys from main process
    const apiKeys: string[] = await ipcRenderer.invoke('rpc:getApiKeys') as string[]

    // Step 2: Build RPC wrappers dynamically (zero-boilerplate: just add to mainAPI)
    // Dotted keys (e.g. "views.list") create nested objects so renderers can call
    // window.electronAPI.main.views.list() with correct TypeScript types.
    const mainAPIWrappers: Record<string, unknown> = {}
    for (const key of apiKeys) {
        const wrapper = (...args: unknown[]): Promise<unknown> => ipcRenderer.invoke('rpc:call', key, args)
        const parts = key.split('.')
        if (parts.length === 1) {
            mainAPIWrappers[key] = wrapper
        } else {
            let target = mainAPIWrappers
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i]!
                if (typeof target[part] !== 'object' || target[part] === null) {
                    target[part] = {}
                }
                target = target[part] as Record<string, unknown>
            }
            target[parts[parts.length - 1]!] = wrapper
        }
    } // see rpc-handler.ts

    // Step 3: Build electronAPI with dynamically generated wrappers
    const electronAPI: ElectronAPI = {
        // Zero-boilerplate RPC pattern - automatic type inference from mainAPI
        main: mainAPIWrappers as unknown as Promisify<typeof mainAPI>,

        // Directory selection
        // openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),

        // File watching event listeners (returns cleanup function like onProjectedGraphUpdate)
        onWatchingStarted: (callback) => {
            type WatchingStartedData = { directory: string; timestamp: string; positions?: Record<string, { x: number; y: number }> };
            const handler: (_event: Electron.IpcRendererEvent, data: WatchingStartedData) => void = (_event, data) => callback(data);
            ipcRenderer.on('watching-started', handler);
            return () => ipcRenderer.off('watching-started', handler);
        },

        onVaultSwitching: (callback) => {
            type VaultSwitchingData = { path: string };
            const handler: (_event: Electron.IpcRendererEvent, data: VaultSwitchingData) => void = (_event, data) => callback(data);
            ipcRenderer.on('vault:switching', handler);
            return () => ipcRenderer.off('vault:switching', handler);
        },

        onVaultReady: (callback) => {
            type VaultReadyData = { path: string };
            const handler: (_event: Electron.IpcRendererEvent, data: VaultReadyData) => void = (_event, data) => callback(data);
            ipcRenderer.on('vault:ready', handler);
            return () => ipcRenderer.off('vault:ready', handler);
        },

        onVaultLost: (callback) => {
            type VaultLostData = { path?: string; error?: string; pid?: number | null };
            const handler: (_event: Electron.IpcRendererEvent, data: VaultLostData) => void = (_event, data) => callback(data);
            ipcRenderer.on('vault:lost', handler);
            return () => ipcRenderer.off('vault:lost', handler);
        },

        onViewSwitched: (callback) => {
            type ViewSwitchedData = { activeViewId: string };
            const handler: (_event: Electron.IpcRendererEvent, data: ViewSwitchedData) => void = (_event, data) => callback(data);
            ipcRenderer.on('view:switched', handler);
            return () => ipcRenderer.off('view:switched', handler);
        },

        // Remove event listeners (cleanup)
        removeAllListeners: (channel) => {
            ipcRenderer.removeAllListeners(channel);
        },

        // Backend log streaming
        onBackendLog: (callback) => {
            ipcRenderer.on('backend-log', (_event, log) => callback(log));
        },

        // Functional graph API
        graph: {
            getCurrentProjectedGraph: () => ipcRenderer.invoke('graph:getCurrentProjectedGraph') as Promise<ProjectedGraph>,

            // Subscribe to projected graph updates from daemon SSE (returns unsubscribe function)
            onProjectedGraphUpdate: (callback: (graph: ProjectedGraph) => void) => {
                const handler: (_event: unknown, graph: ProjectedGraph) => void = (_event: unknown, graph: ProjectedGraph) => callback(graph);
                ipcRenderer.on('graph:projectedGraphUpdate', handler);
                return () => ipcRenderer.off('graph:projectedGraphUpdate', handler);
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
            const ALLOWED_INVOKE_CHANNELS: Set<string> = new Set([
                'rpc:call',
                'rpc:getApiKeys',
                'graph:getCurrentProjectedGraph',
            ]);
            if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
                console.error(`[Preload] SECURITY: Blocked invoke to unauthorized channel: ${channel}`);
                return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
            }
            return ipcRenderer.invoke(channel, ...args);
        },
        on: (channel: string, listener: (...args: unknown[]) => void) => {
            // Security: Only allow subscribing to specific event channels
            const ALLOWED_ON_CHANNELS: Set<string> = new Set([
                'backend-log',
                'graph:projectedGraphUpdate',
                'graph:clear',
                'watching-started',
                'vault:switching',
                'vault:ready',
                'vault:lost',
                'ui:call',
                'view:switched',
            ]);
            if (!ALLOWED_ON_CHANNELS.has(channel)) {
                console.error(`[Preload] SECURITY: Blocked subscription to unauthorized channel: ${channel}`);
                return;
            }
            return ipcRenderer.on(channel, listener);
        },
        off: (channel: string, listener: (...args: unknown[]) => void) => {
            // Security: Match the same allowlist as 'on'
            const ALLOWED_OFF_CHANNELS: Set<string> = new Set([
                'backend-log',
                'graph:projectedGraphUpdate',
                'graph:clear',
                'watching-started',
                'vault:switching',
                'vault:ready',
                'vault:lost',
                'ui:call',
                'view:switched',
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
