// Installs window.electronAPI with the browser adapter if Electron preload
// has not already provided it. Must be imported before React bootstraps.
// Safe to import in Electron — the guard prevents double-installation.

import {discoverBrowserConfig} from './browserConfig'
import {graphdCreateSession} from './graphdFetch'
import {buildBrowserRuntime} from './browserRuntime'

export async function installBrowserRuntimeIfNeeded(): Promise<void> {
    if (window.electronAPI !== undefined) return // Electron preload already installed

    try {
        const cfg = await discoverBrowserConfig()
        const {sessionId} = await graphdCreateSession(cfg.graphdUrl)
        const runtime = buildBrowserRuntime(cfg, sessionId)
        ;(window as unknown as {electronAPI: typeof runtime}).electronAPI = runtime
        // Expose the session ID for debugging and test assertions
        ;(window as unknown as {__VT_SESSION_ID__: string}).__VT_SESSION_ID__ = sessionId
        console.info('[browserRuntime] installed, session:', sessionId, 'vtd:', cfg.vtdUrl)
    } catch (err) {
        console.error('[browserRuntime] failed to install:', err)
        // Don't throw — the app will render its "no backend" state naturally
    }
}
