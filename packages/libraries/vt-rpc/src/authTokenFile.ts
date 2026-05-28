// Read of the daemon's bearer auth token from
// `<vault>/.voicetree/auth-token`. The daemon writes the token at startup
// (mode 0600, atomic). Filesystem permissions are the trust root; the value
// returned here goes into the `Authorization: Bearer …` header on every RPC
// and WS upgrade. Design doc §2.4.

import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

export const VOICETREE_DIRNAME: string = '.voicetree'
export const AUTH_TOKEN_FILENAME: string = 'auth-token'

export function authTokenFilePath(vaultPath: string): string {
    return join(resolve(vaultPath), VOICETREE_DIRNAME, AUTH_TOKEN_FILENAME)
}

// Returns null when the file is missing or contains an obviously-invalid
// token. Empty / whitespace-only files map to null so callers can distinguish
// "daemon not running" from "daemon running with empty token" (the latter
// indicates a daemon bug — we surface that as missing rather than passing
// through a useless empty bearer header).
export async function readAuthTokenFile(vaultPath: string): Promise<string | null> {
    try {
        const text: string = await readFile(authTokenFilePath(vaultPath), 'utf8')
        const trimmed: string = text.trim()
        return trimmed.length > 0 ? trimmed : null
    } catch {
        return null
    }
}

// Redact a bearer-token-bearing string for logs. Used by both client error
// messages and the daemon's access logger; isolating it here means the
// redaction policy lives in one place. Token suffix is kept (last 4 chars)
// to make log-line correlation possible without disclosing the full secret.
export function redactToken(token: string): string {
    if (token.length <= 4) return '****'
    return `****${token.slice(-4)}`
}

// Redact the value of a single `Authorization` header. Returns the header
// value verbatim when it isn't a bearer (so other auth schemes surface
// unredacted — we don't claim to handle them). For `Bearer …`, the token
// portion is run through `redactToken`.
export function redactAuthorizationHeader(value: string): string {
    const prefix: string = 'Bearer '
    if (!value.startsWith(prefix)) return value
    return `${prefix}${redactToken(value.slice(prefix.length).trim())}`
}
