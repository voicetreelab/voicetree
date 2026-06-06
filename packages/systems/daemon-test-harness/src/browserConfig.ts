// Pure config-shaping for the browser daemon e2e harness. No I/O — given a
// parsed `vt serve` ready line, the minted token, and the project path, produce
// the exact config the browser runtime expects in `window.__VT_BROWSER_CONFIG__`.
//
// Mirrors webapp's `shell/edge/browser/browserConfig.ts` BrowserDaemonConfig.
// Under the VTD-gateway model (Fix B/C) the browser talks ONLY to VTD —
// vt-graphd is loopback-internal behind it — so the config carries no graphd
// URL: vtdUrl + vtdToken + projectPath is the whole contract.

import type {ServeReady} from './serveHarness.ts'

export interface BrowserDaemonConfig {
    readonly vtdUrl: string
    readonly vtdToken: string
    readonly projectPath: string
}

export function buildBrowserConfig(ready: ServeReady, token: string, project: string): BrowserDaemonConfig {
    return {
        vtdUrl: ready.vtdUrl,
        vtdToken: token,
        projectPath: project,
    }
}
