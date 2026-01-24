/**
 * UI RPC Handler - Handles IPC calls from main process to UI functions
 *
 * This sets up a listener for 'ui:call' events and dispatches them
 * to the appropriate function in uiAPI.
 */

import { uiAPIHandler } from '@/shell/edge/UI-edge/api';
import type { ElectronAPI } from '@/shell/electron';

type UIAPIKey = keyof typeof uiAPIHandler;
type UIAPIFunction = (typeof uiAPIHandler)[UIAPIKey];

/**
 * Setup the UI RPC handler to listen for calls from main process
 * Should be called once during renderer initialization
 */
export function setupUIRpcHandler(): void {
    const electronAPI: ElectronAPI | undefined = window.electronAPI;

    if (!electronAPI?.on) {
        console.warn('[UI RPC] electronAPI.on not available, skipping UI RPC handler setup');
        return;
    }

    console.log('[UI RPC] Handler registered, listening for ui:call');

    electronAPI.on('ui:call', (_event: unknown, funcName: unknown, args: unknown) => {
        console.log('[UI RPC] Received call:', funcName, args);
        const fnName: string = funcName as string;
        const fnArgs: unknown[] = args as unknown[];

        const fn: UIAPIFunction | undefined = uiAPIHandler[fnName as UIAPIKey];

        if (typeof fn !== 'function') {
            console.error(`[UI RPC] Unknown UI function: ${fnName}`);
            return;
        }

        // Call the function with spread args
        void (fn as (...a: unknown[]) => unknown)(...fnArgs);
    });

    //console.log('[UI RPC] Handler initialized');
}
