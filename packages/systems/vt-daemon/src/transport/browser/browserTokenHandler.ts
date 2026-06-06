// Handler for the unauthenticated GET /browser-token route.
//
// Delivers the VTD bearer token (plus the project path) to a browser tab whose
// Origin is in the operator-configured allowed set. This makes it possible
// for a Vite dev server (or same-origin served app) to bootstrap without
// reading the filesystem.
//
// Under the VTD gateway model (RE-PLAN B) the browser talks ONLY to VTD; it is
// deliberately given NO graphd URL, so the gateway is structurally enforced —
// the browser has no graphd address to reach even if it tried.
//
// Security model: the Origin header is the gate. Browsers enforce it for
// cross-origin requests; non-browser clients that forge Origin can already
// reach this loopback port by other means. The route only exists when the
// daemon was started with a non-empty allowedOrigins list — i.e. only when
// the operator explicitly opts in to browser-mode CORS.

import type {IncomingMessage, ServerResponse} from 'node:http'
import {isAllowedOrigin, requestOrigin} from './corsHeaders.ts'
import type {AccessLogger} from '../httpServerTypes.ts'
import {buildAccessLogLine} from '../accessLog.ts'

export interface BrowserBootstrapPayload {
    readonly token: string
    readonly projectPath: string | null
}

export function handleBrowserToken(
    req: IncomingMessage,
    res: ServerResponse,
    payload: BrowserBootstrapPayload,
    allowedOrigins: readonly string[],
    logger: AccessLogger,
): void {
    const origin = requestOrigin(req)
    if (origin === undefined || !isAllowedOrigin(origin, allowedOrigins)) {
        res.statusCode = 403
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({error: 'origin not allowed'}))
        logger.logRequest(buildAccessLogLine(req, 403))
        return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(payload))
    logger.logRequest(buildAccessLogLine(req, 200))
}
