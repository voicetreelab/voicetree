// Browser-mode daemon config discovery.
// Priority: window.__VT_BROWSER_CONFIG__ > VITE env vars > fetch /browser-token from VTD URL.
// Keeps filesystem secrets out of the renderer — the token arrives over HTTP,
// never in a checked-in file.
//
// Under the gateway model the browser talks ONLY to VTD; vt-graphd is
// loopback-internal behind it, so no graphd URL is ever delivered to or used by
// the renderer.

export interface BrowserDaemonConfig {
    readonly vtdUrl: string
    readonly vtdToken: string
    readonly projectPath: string
}

declare global {
    interface Window {
        __VT_BROWSER_CONFIG__?: Partial<BrowserDaemonConfig>
    }
}

interface BrowserTokenResponse {
    token: string
    projectPath: string | null
}

async function fetchBrowserToken(vtdUrl: string, origin: string): Promise<BrowserTokenResponse> {
    const res = await fetch(`${vtdUrl}/browser-token`, {headers: {Origin: origin}})
    if (!res.ok) throw new Error(`GET /browser-token → ${res.status}`)
    return res.json() as Promise<BrowserTokenResponse>
}

export async function discoverBrowserConfig(): Promise<BrowserDaemonConfig> {
    const win = window.__VT_BROWSER_CONFIG__ ?? {}

    const vtdUrl = win.vtdUrl
        ?? import.meta.env.VITE_VTD_URL
        ?? null
    const projectPath = win.projectPath
        ?? import.meta.env.VITE_PROJECT_PATH
        ?? null

    // Token: explicit > env > fetch from VTD /browser-token
    let vtdToken = win.vtdToken ?? import.meta.env.VITE_VTD_TOKEN ?? null
    let resolvedProjectPath = projectPath

    if (!vtdToken && vtdUrl) {
        const payload = await fetchBrowserToken(vtdUrl, window.location.origin)
        vtdToken = payload.token
        resolvedProjectPath ??= payload.projectPath ?? null
    }

    if (!vtdUrl) throw new Error('[browserConfig] vtdUrl unknown — set VITE_VTD_URL or window.__VT_BROWSER_CONFIG__')
    if (!vtdToken) throw new Error('[browserConfig] vtdToken unknown — set VITE_VTD_TOKEN or configure /browser-token')
    if (!resolvedProjectPath) throw new Error('[browserConfig] projectPath unknown — set VITE_PROJECT_PATH or configure /browser-token')

    return {
        vtdUrl,
        vtdToken,
        projectPath: resolvedProjectPath,
    }
}
