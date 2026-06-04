// Widen the static browser-mode CSP (webapp/index.html) for `vt webapp --lan`.
//
// In --lan mode the renderer is served to other devices and pointed at vt-daemon
// (VTD) on this machine's LAN IP, not loopback. The committed CSP <meta> only
// allows loopback in connect-src/img-src/media-src, so without this the renderer's
// fetch/websocket to the LAN VTD origin is CSP-blocked and window.hostAPI never
// installs. `vt webapp` exports the renderer-facing VTD URL as VITE_VTD_URL; this
// derives the LAN host from it and adds `http://<host>:*` / `ws://<host>:*`
// everywhere loopback is already permitted — the same narrowing (one specific
// host), just the routable one. Loopback launches leave the policy byte-for-byte
// untouched, so the default security posture is unchanged.

import type {Plugin} from 'vite'

// The LAN host VTD is reachable at, or null when the URL is absent/loopback (no
// widening needed). Loopback hosts keep the committed policy unchanged.
export function lanCspHost(vtdUrl: string | undefined): string | null {
    if (!vtdUrl) return null
    let host: string
    try {
        host = new URL(vtdUrl).hostname
    } catch {
        return null
    }
    // URL.hostname brackets IPv6 literals (e.g. `[::1]`); strip them before comparing.
    const bare: string = host.replace(/^\[|\]$/g, '')
    if (bare === '127.0.0.1' || bare === 'localhost' || bare === '::1') return null
    return host
}

// Mirror every loopback allowance onto the LAN host. The CSP enumerates
// `http://127.0.0.1:*` in connect-src/img-src/media-src and `ws://127.0.0.1:*` in
// connect-src; widening exactly those keeps the directive set identical in shape.
export function widenCspForLan(html: string, host: string): string {
    return html
        .replaceAll('http://127.0.0.1:*', `http://127.0.0.1:* http://${host}:*`)
        .replaceAll('ws://127.0.0.1:*', `ws://127.0.0.1:* ws://${host}:*`)
}

export function lanCspPlugin(): Plugin {
    return {
        name: 'vt-lan-csp',
        transformIndexHtml(html: string): string {
            const host: string | null = lanCspHost(process.env.VITE_VTD_URL)
            return host ? widenCspForLan(html, host) : html
        },
    }
}
