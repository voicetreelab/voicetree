// Installs window.hostAPI with the browser adapter if Electron preload
// has not already provided it. Must be imported before React bootstraps.
// Safe to import in Electron — the guard prevents double-installation.

import {discoverBrowserConfig} from './browserConfig'
import {vtdOpenProject} from './vtd-clients/vtdGraphClient'
import {buildBrowserRuntime} from './browserRuntime'

export async function installBrowserRuntimeIfNeeded(): Promise<void> {
    if (window.hostAPI !== undefined) return // Electron preload already installed

    try {
        const cfg = await discoverBrowserConfig()
        // `graph.openProject` establishes (idempotently) the single VTD-owned
        // graphd session and yields its id — the one session threaded end-to-end
        // (graph + terminal-registry SSE). Replaces graphd's old POST /sessions.
        const {sessionId} = await vtdOpenProject(cfg.vtdUrl, cfg.vtdToken)
        const runtime = buildBrowserRuntime(cfg, sessionId)
        ;(window as unknown as {hostAPI: typeof runtime}).hostAPI = runtime
        // Expose the session ID for debugging and test assertions
        ;(window as unknown as {__VT_SESSION_ID__: string}).__VT_SESSION_ID__ = sessionId
        console.info('[browserRuntime] installed, session:', sessionId, 'vtd:', cfg.vtdUrl)
    } catch (err) {
        console.error('[browserRuntime] failed to install:', err)
        // Don't throw — the app will render its "no backend" state naturally
    }
}
