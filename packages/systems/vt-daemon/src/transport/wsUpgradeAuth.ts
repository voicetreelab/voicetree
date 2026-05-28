// Authorization for the unified HTTP daemon.
//
// Two accepted mechanisms — both validated BEFORE the WS handshake completes:
//
//   1. `Authorization: Bearer <token>` — used by HTTP routes (/rpc, /hook/:source)
//      and Node `ws`-library clients (tests, CLI, graph-tools).
//   2. `Sec-WebSocket-Protocol: vt-bearer, <token>` — used by browser WebSocket
//      clients (the Electron renderer running with contextIsolation=on,
//      nodeIntegration=off), which cannot set arbitrary request headers.
//
// HTTP routes accept ONLY (1). WS upgrade routes accept EITHER.
//
// The subprotocol mechanism overrides docs/step9-design.md §4.3 per
// `ctx-nodes/.../step9-design-override-ws-subprotocol-auth.md` (Gus, 2026-05-22),
// surfaced mid-9e by Iris when the renderer hit "Server sent no subprotocol"
// against a header-only 9b daemon. RFC 6455 §1.9 permits arbitrary subprotocol
// strings; the literal "vt-bearer" is opaque to the spec.

import {timingSafeEqual} from 'node:crypto'
import type {IncomingMessage} from 'node:http'

export const VT_BEARER_SUBPROTOCOL: string = 'vt-bearer'

export function authorizationHeaderOf(req: IncomingMessage): string | undefined {
    const raw: string | string[] | undefined = req.headers.authorization
    if (Array.isArray(raw)) return raw[0]
    return raw
}

export function isAuthorized(req: IncomingMessage, token: string): boolean {
    const value: string | undefined = authorizationHeaderOf(req)
    if (!value) return false
    const expected: string = `Bearer ${token}`
    return value === expected
}

function subprotocolHeaderOf(req: IncomingMessage): string | undefined {
    const raw: string | string[] | undefined = req.headers['sec-websocket-protocol']
    if (Array.isArray(raw)) return raw[0]
    return raw
}

function constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

export type WsUpgradeAuthMode = 'header' | 'subprotocol'

// Authorize a WebSocket upgrade request. Returns the matched mode so the
// caller can echo the negotiated subprotocol back (or refrain from echoing
// any subprotocol when auth came via the Authorization header).
//
// Subprotocol grammar (strict): the header value MUST parse as exactly two
// comma-separated tokens, the first the literal `vt-bearer` (case-sensitive),
// the second the hex bearer token. Any other shape → null → 401.
export function authorizeWsUpgrade(req: IncomingMessage, token: string): WsUpgradeAuthMode | null {
    if (isAuthorized(req, token)) return 'header'

    const header: string | undefined = subprotocolHeaderOf(req)
    if (header === undefined) return null

    const parts: string[] = header.split(',').map((part: string): string => part.trim())
    if (parts.length !== 2) return null
    if (parts[0] !== VT_BEARER_SUBPROTOCOL) return null
    if (!constantTimeEquals(parts[1], token)) return null
    return 'subprotocol'
}
