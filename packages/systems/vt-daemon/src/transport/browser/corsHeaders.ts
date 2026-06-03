// CORS header utilities for VTD's HTTP transport.
// Origins are never wildcarded: the exact requested origin is reflected back so
// credentialed requests work and non-allowed origins get nothing. Two origin
// shapes are accepted into the allowlist — loopback (always) and private-LAN
// IPv4 (opt-in, for `vt webapp --lan` so a phone/tablet on the same network can
// reach the daemon). Public/remote hosts and https are always rejected.

import type {IncomingMessage, ServerResponse} from 'node:http'

// Matches http://localhost:<port> and http://127.0.0.1:<port> only.
// IPv6 loopback http://[::1]:<port> is also accepted.
// Anything else (https, remote hosts, bare localhost without port) is rejected.
const LOCALHOST_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/

// Matches http://<private-range IPv4>:<port> — RFC1918 ranges only
// (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). Used for LAN mode; a daemon
// only ever sees these if an operator explicitly put one in VOICETREE_CORS_ORIGINS.
const PRIVATE_LAN_ORIGIN_RE =
    /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}):\d{1,5}$/

export function isLocalhostOrigin(origin: string): boolean {
    return LOCALHOST_ORIGIN_RE.test(origin)
}

export function isPrivateLanHttpOrigin(origin: string): boolean {
    return PRIVATE_LAN_ORIGIN_RE.test(origin)
}

/**
 * Parse a comma-separated VOICETREE_CORS_ORIGINS string into a validated list.
 * Accepts loopback origins (http://localhost|127.0.0.1|[::1]:<port>) and
 * private-LAN IPv4 origins (http://10.x|172.16-31.x|192.168.x:<port>, for LAN
 * mode). Any other entry — public host, https, malformed — is dropped with a
 * stderr warning. Returns an empty array when the input is empty or blank.
 */
export function parseDevCorsOrigins(raw: string): string[] {
    if (raw.trim() === '') return []
    const result: string[] = []
    for (const entry of raw.split(',')) {
        const origin = entry.trim()
        if (origin === '') continue
        if (isLocalhostOrigin(origin) || isPrivateLanHttpOrigin(origin)) {
            result.push(origin)
        } else {
            process.stderr.write(
                `[vtd] VOICETREE_CORS_ORIGINS: rejected origin "${origin}" — only http loopback (localhost/127.0.0.1) and private-LAN IPv4 (10.x/172.16-31.x/192.168.x) origins with a port are allowed\n`,
            )
        }
    }
    return result
}

export function isAllowedOrigin(origin: string, allowedOrigins: readonly string[]): boolean {
    return allowedOrigins.includes(origin)
}

export function requestOrigin(req: IncomingMessage): string | undefined {
    const raw = req.headers.origin
    return Array.isArray(raw) ? raw[0] : raw
}

export function applyCorsHeaders(req: IncomingMessage, res: ServerResponse, allowedOrigins: readonly string[]): void {
    const origin = requestOrigin(req)
    if (origin === undefined || !isAllowedOrigin(origin, allowedOrigins)) return
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
}

export function applyPreflightCorsHeaders(req: IncomingMessage, res: ServerResponse, allowedOrigins: readonly string[]): void {
    applyCorsHeaders(req, res, allowedOrigins)
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '86400')
}
