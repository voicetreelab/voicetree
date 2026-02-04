/**
 * UI API Proxy - Typed proxy for calling UI functions from main process
 *
 * This creates a symmetric pattern with the existing mainAPI:
 * - UI → Main: window.electronAPI.main.someFunc()
 * - Main → UI: uiAPI.someFunc()
 *
 * Type safety is achieved by importing UIAPIType from the renderer's api.ts
 * The actual calls are sent via IPC to the renderer's ui:call handler.
 */

import type { UIAPIType } from '@/shell/edge/UI-edge/api';
import { getMainWindow } from '@/shell/edge/main/state/app-electron-state';

/**
 * Proxy that sends IPC calls to renderer, typed as UIAPIType
 * This allows main process to call UI functions with full type safety
 */
export const uiAPI: UIAPIType = new Proxy({} as UIAPIType, {
    get(_target, prop: string) {
        return (...args: unknown[]) => {
            const mainWindow: ReturnType<typeof getMainWindow> = getMainWindow();
            if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
                console.log('[uiAPI] Window not available, skipping:', prop);
                return;
            }
            // Send IPC call to renderer
            // console.log('[uiAPI] Sending IPC:', prop, args);
            mainWindow.webContents.send('ui:call', prop, args);
        };
    }
});
