// Browser-mode daemon config discovery.
// Priority: window.__VT_BROWSER_CONFIG__ > VITE env vars > fetch /browser-token from VTD URL.
// Keeps filesystem secrets out of the renderer — the token arrives over HTTP,
// never in a checked-in file.

export interface BrowserDaemonConfig {
    readonly vtdUrl: string
    readonly vtdToken: string
    readonly graphdUrl: string
    readonly projectPath: string
}

declare global {
    interface Window {
        __VT_BROWSER_CONFIG__?: Partial<BrowserDaemonConfig>
    }
}

interface BrowserTokenResponse {
    token: string
    graphdUrl: string | null
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
    const graphdUrl = win.graphdUrl
        ?? import.meta.env.VITE_GRAPHD_URL
        ?? null
    const projectPath = win.projectPath
        ?? import.meta.env.VITE_PROJECT_PATH
        ?? null

    // Token: explicit > env > fetch from VTD /browser-token
    let vtdToken = win.vtdToken ?? import.meta.env.VITE_VTD_TOKEN ?? null
    let resolvedGraphdUrl = graphdUrl
    let resolvedProjectPath = projectPath

    if (!vtdToken && vtdUrl) {
        const payload = await fetchBrowserToken(vtdUrl, window.location.origin)
        vtdToken = payload.token
        resolvedGraphdUrl ??= payload.graphdUrl ?? null
        resolvedProjectPath ??= payload.projectPath ?? null
    }

    if (!vtdUrl) throw new Error('[browserConfig] vtdUrl unknown — set VITE_VTD_URL or window.__VT_BROWSER_CONFIG__')
    if (!vtdToken) throw new Error('[browserConfig] vtdToken unknown — set VITE_VTD_TOKEN or configure /browser-token')
    if (!resolvedGraphdUrl) throw new Error('[browserConfig] graphdUrl unknown — set VITE_GRAPHD_URL or configure /browser-token')
    if (!resolvedProjectPath) throw new Error('[browserConfig] projectPath unknown — set VITE_PROJECT_PATH or configure /browser-token')

    return {
        vtdUrl,
        vtdToken,
        graphdUrl: resolvedGraphdUrl,
        projectPath: resolvedProjectPath,
    }
}
