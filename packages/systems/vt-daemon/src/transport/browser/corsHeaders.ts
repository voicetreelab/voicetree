// CORS header utilities for VTD's HTTP transport.
// Only exact-match localhost origins are ever granted CORS — never wildcard.
// Browsers send Origin on every cross-origin request; we reflect the exact
// origin back rather than using '*' so credentialed requests work and so
// non-allowed origins get nothing (not even a wildcard match).

import type {IncomingMessage, ServerResponse} from 'node:http'

// Matches http://localhost:<port> and http://127.0.0.1:<port> only.
// IPv6 loopback http://[::1]:<port> is also accepted.
// Anything else (https, remote hosts, bare localhost without port) is rejected.
const LOCALHOST_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/

export function isLocalhostOrigin(origin: string): boolean {
    return LOCALHOST_ORIGIN_RE.test(origin)
}

/**
 * Parse a comma-separated VOICETREE_CORS_ORIGINS string into a validated list.
 * Only http://localhost:<port>, http://127.0.0.1:<port>, and http://[::1]:<port>
 * are accepted. Any other entry is dropped with a stderr warning.
 * Returns an empty array when the input is empty or blank.
 */
export function parseLocalhostCorsOrigins(raw: string): string[] {
    if (raw.trim() === '') return []
    const result: string[] = []
    for (const entry of raw.split(',')) {
        const origin = entry.trim()
        if (origin === '') continue
        if (isLocalhostOrigin(origin)) {
            result.push(origin)
        } else {
            process.stderr.write(
                `[vtd] VOICETREE_CORS_ORIGINS: rejected non-localhost origin "${origin}" — only http://localhost:<port> and http://127.0.0.1:<port> are allowed\n`,
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
