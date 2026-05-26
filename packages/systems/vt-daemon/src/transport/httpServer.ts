// Unified HTTP daemon server. Single http.createServer bound to 0.0.0.0 (or
// $VOICETREE_DAEMON_BIND). Five routes per design doc §2.5 / §4:
//   POST /rpc                        — JSON-RPC tool dispatch (catalog)
//   POST /hook/:source               — agent lifecycle ingestion
//   GET  /events                     — WebSocket subscription channel
//   GET  /terminals/:id/attach       — tmux relay (wired in Step 9f)
//   GET  /health                     — owner-identity probe (BF-372,
//                                       unauthenticated; everything else
//                                       is bearer-gated)
//
// Auth — design doc §4.3 + the §4.3 subprotocol override carried in
// ctx-nodes/.../step9-design-override-ws-subprotocol-auth.md (Gus, 2026-05-22):
//   - HTTP routes accept `Authorization: Bearer <token>` only.
//   - WS upgrade routes accept EITHER `Authorization: Bearer <token>` (ws-lib
//     clients) OR `Sec-WebSocket-Protocol: vt-bearer, <token>` (browser/
//     renderer WebSocket clients). See ./wsUpgradeAuth.ts.
// The same gate covers the WS upgrade — bad tokens are rejected BEFORE the
// WS handshake completes.
//
// Body caps: 64 KiB on /rpc and /hook (§4.1). WS inbound frame cap 256 KiB
// (close 1009, §8.6). Per-subscriber outbound buffer cap 1 MiB / 1000 frames
// (close 1011, §2.6 — enforced in eventSubscriptionHub).
//
// Access log: every request logged WITH the Authorization header redacted
// via @vt/vt-rpc#redactAuthorizationHeader. Unit-tested.

import http, {type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {Duplex} from 'node:stream'
import {WebSocket, WebSocketServer} from 'ws'

import type {VtDaemonHealthResponse} from '../contract.ts'
import {createEventSubscriptionHub, type EventSubscriptionHub} from './eventSubscriptionHub.ts'
import {
    authorizeWsUpgrade,
    isAuthorized,
    VT_BEARER_SUBPROTOCOL,
    type WsUpgradeAuthMode,
} from './wsUpgradeAuth.ts'
import {wireWebSocketSubscriber} from './wsSubscriberWiring.ts'
import {createTmuxAttachWiring, type TmuxAttachWiring} from './tmuxAttachWiring.ts'
import {buildAccessLogLine} from './accessLog.ts'
import {readBodyWithCap} from './bodyReader.ts'
import {handleRpc} from './rpcDispatch.ts'
import type {
    AccessLogger,
    HookHandler,
    HttpDaemonServerHandle,
    ToolCatalog,
} from './httpServerTypes.ts'

// Re-export the surface types so existing consumers (`@vt/vt-daemon` barrel,
// transport tests) keep their import paths. The implementation lives in
// httpServerTypes.ts; the re-export is the stable public surface.
export type {
    AccessLogger,
    HookHandler,
    HookHandlerInvocation,
    HttpDaemonServerHandle,
    ToolCatalog,
    ToolHandler,
} from './httpServerTypes.ts'
export {buildAccessLogLine} from './accessLog.ts'
export {isAuthorized} from './wsUpgradeAuth.ts'

export interface StartHttpDaemonOptions {
    readonly catalog: ToolCatalog
    readonly hookHandler: HookHandler
    readonly token: string
    readonly bindHost?: string
    readonly port?: number
    readonly logger?: AccessLogger
    /**
     * Owner-identity projector consulted on every GET /health request
     * (BF-372). Optional during the Phase-1 decomposition: callers that
     * have not yet wired the projector (Electron embedding, harness
     * fixtures, the existing vt-mcpd shim) will see GET /health return
     * 503 with a json error body so the unwired state is observable
     * rather than silently presenting an empty `/health`. The vtd
     * binary (Leaf C / Bob's post-merge wiring) supplies this and
     * unlocks the discovery probe used by BF-373's ensure path.
     */
    readonly readHealth?: () => VtDaemonHealthResponse
}

const WS_INBOUND_FRAME_LIMIT_BYTES: number = 256 * 1024
const RPC_PATH: string = '/rpc'
const HOOK_PATH_PREFIX: string = '/hook/'
const EVENTS_PATH: string = '/events'
const HEALTH_PATH: string = '/health'

function defaultLogger(): AccessLogger {
    return {
        logRequest: (line: string): void => { process.stderr.write(`${line}\n`) },
        logError: (line: string, err?: unknown): void => {
            process.stderr.write(`${line}${err ? `: ${err instanceof Error ? err.message : String(err)}` : ''}\n`)
        },
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unauthorized(req: IncomingMessage, res: ServerResponse, logger: AccessLogger): void {
    res.statusCode = 401
    res.end()
    logger.logRequest(buildAccessLogLine(req, 401))
}

function notFound(req: IncomingMessage, res: ServerResponse, logger: AccessLogger): void {
    res.statusCode = 404
    res.end()
    logger.logRequest(buildAccessLogLine(req, 404))
}

function methodNotAllowed(req: IncomingMessage, res: ServerResponse, logger: AccessLogger): void {
    res.statusCode = 405
    res.end()
    logger.logRequest(buildAccessLogLine(req, 405))
}

async function handleHook(
    req: IncomingMessage,
    res: ServerResponse,
    hookHandler: HookHandler,
    hub: EventSubscriptionHub,
    logger: AccessLogger,
): Promise<void> {
    const url: URL = new URL(req.url ?? '/', 'http://127.0.0.1')
    const source: string = url.pathname.slice(HOOK_PATH_PREFIX.length)
    const terminalId: string | undefined = url.searchParams.get('terminal') ?? undefined
    const queryEvent: string | undefined = url.searchParams.get('event') ?? undefined

    const body: string | {tooLarge: true} = await readBodyWithCap(req)
    if (typeof body !== 'string') {
        res.statusCode = 413
        res.end()
        logger.logRequest(buildAccessLogLine(req, 413))
        return
    }

    let parsedBody: Record<string, unknown> | undefined
    if (body.length > 0) {
        try {
            const raw: unknown = JSON.parse(body)
            parsedBody = isRecord(raw) ? raw : undefined
        } catch {
            parsedBody = undefined
        }
    }
    const bodyEvent: string | undefined = parsedBody && typeof parsedBody.hook_event_name === 'string'
        ? parsedBody.hook_event_name
        : undefined
    const eventName: string | undefined = bodyEvent ?? queryEvent

    const result: unknown = hookHandler({source, terminalId, eventName})
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(result))
    logger.logRequest(buildAccessLogLine(req, 200))

    // The body is parsed only to extract `hook_event_name` (already done
    // above); we don't forward `parsedBody` to the handler because the
    // handler contract takes the resolved event name.
    void parsedBody

    // Publish agent-lifecycle event regardless of whether the hook handler
    // ignored or mapped it — subscribers learn about every hook ingestion.
    // Source typing kept loose intentionally; subscriber decides what to do.
    if (terminalId && eventName) {
        hub.publish('agent-lifecycle', eventName, {
            terminalId,
            source,
            at: Date.now(),
            handlerResult: result,
        })
    }
}

function isWebsocketUpgrade(req: IncomingMessage): boolean {
    return req.headers.upgrade?.toLowerCase() === 'websocket'
}

function rejectUpgradeUnauthorized(socket: Duplex): void {
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    socket.destroy()
}

function rejectUpgradeNotFound(socket: Duplex): void {
    socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    socket.destroy()
}

function handleHealth(
    req: IncomingMessage,
    res: ServerResponse,
    readHealth: (() => VtDaemonHealthResponse) | undefined,
    logger: AccessLogger,
): void {
    res.setHeader('Content-Type', 'application/json')
    if (readHealth === undefined) {
        // Optional during Phase-1 decomposition (see StartHttpDaemonOptions).
        // 503 is the correct signal: the daemon is up but cannot answer the
        // identity question, so a probe should treat the daemon as not yet
        // claimable rather than fall through to a generic 404.
        res.statusCode = 503
        res.end(JSON.stringify({error: 'health probe not wired'}))
        logger.logRequest(buildAccessLogLine(req, 503))
        return
    }
    res.statusCode = 200
    res.end(JSON.stringify(readHealth()))
    logger.logRequest(buildAccessLogLine(req, 200))
}

function buildRequestHandler(
    catalog: ToolCatalog,
    hookHandler: HookHandler,
    hub: EventSubscriptionHub,
    token: string,
    logger: AccessLogger,
    readHealth: (() => VtDaemonHealthResponse) | undefined,
): (req: IncomingMessage, res: ServerResponse) => void {
    return (req: IncomingMessage, res: ServerResponse): void => {
        const method: string = req.method ?? 'GET'
        const url: string = req.url ?? '/'

        if (method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            logger.logRequest(buildAccessLogLine(req, 204))
            return
        }
        // /health is the ONLY unauthenticated route. Placement BEFORE the
        // isAuthorized gate is intentional and load-bearing: BF-373's
        // ensure path invokes probeOwnerHealth BEFORE it has read
        // <vault>/.voicetree/auth-token — that probe IS the gate that
        // decides whether to read the token. Gating /health on auth would
        // chicken-and-egg the discovery path. Mirrors graphd's
        // unauthenticated /health.
        if (method === 'GET' && url === HEALTH_PATH) {
            handleHealth(req, res, readHealth, logger)
            return
        }
        if (!isAuthorized(req, token)) {
            unauthorized(req, res, logger)
            return
        }

        if (method === 'POST' && url === RPC_PATH) {
            void handleRpc(req, res, catalog, logger).catch((err: unknown): void => {
                logger.logError('rpc handler error', err)
                if (!res.headersSent) { res.statusCode = 500; res.end() }
            })
            return
        }
        if (method === 'POST' && url.startsWith(HOOK_PATH_PREFIX)) {
            void handleHook(req, res, hookHandler, hub, logger).catch((err: unknown): void => {
                logger.logError('hook handler error', err)
                if (!res.headersSent) { res.statusCode = 500; res.end() }
            })
            return
        }
        if (
            method !== 'POST'
            && (url === RPC_PATH || url.startsWith(HOOK_PATH_PREFIX))
        ) {
            methodNotAllowed(req, res, logger)
            return
        }
        // /events and /terminals/:id/attach are GET-upgrade only; reaching
        // here means a non-upgrade GET to the WS routes (or genuine 404).
        // GET /health with no readHealth has already been answered above.
        // POST /health (or any other method/path) falls through here.
        notFound(req, res, logger)
    }
}

function buildUpgradeHandler(
    wss: WebSocketServer,
    tmuxAttach: TmuxAttachWiring,
    hub: EventSubscriptionHub,
    token: string,
    logger: AccessLogger,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
    return (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        if (!isWebsocketUpgrade(req)) {
            rejectUpgradeNotFound(socket)
            logger.logRequest(buildAccessLogLine(req, 400))
            return
        }
        const authMode: WsUpgradeAuthMode | null = authorizeWsUpgrade(req, token)
        if (authMode === null) {
            rejectUpgradeUnauthorized(socket)
            logger.logRequest(buildAccessLogLine(req, 401))
            return
        }
        if (authMode === 'header') {
            // No subprotocol was negotiated; strip any client-sent value so
            // ws won't echo it back in the 101 (per override-doc handshake).
            delete req.headers['sec-websocket-protocol']
        }

        // Parse pathname first — req.url carries any query string (e.g. the
        // renderer's ?cols=120&rows=40 on attach), so matching against req.url
        // directly would miss anchored route patterns. Mirrors handleHook.
        const pathname: string = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
        if (pathname === EVENTS_PATH) {
            wss.handleUpgrade(req, socket, head, (ws: WebSocket): void => {
                logger.logRequest(buildAccessLogLine(req, 101))
                wireWebSocketSubscriber(ws, hub)
            })
            return
        }
        if (tmuxAttach.matchesPathname(pathname)) {
            tmuxAttach.acceptUpgrade(req, socket, head, (): void => {
                logger.logRequest(buildAccessLogLine(req, 101))
            })
            return
        }
        rejectUpgradeNotFound(socket)
        logger.logRequest(buildAccessLogLine(req, 404))
    }
}

export async function startHttpDaemonServer(options: StartHttpDaemonOptions): Promise<HttpDaemonServerHandle> {
    const logger: AccessLogger = options.logger ?? defaultLogger()
    const hub: EventSubscriptionHub = createEventSubscriptionHub()

    const wss: WebSocketServer = new WebSocketServer({
        noServer: true,
        maxPayload: WS_INBOUND_FRAME_LIMIT_BYTES,
        // The upgrade handler has already stripped Sec-WebSocket-Protocol when
        // auth came via Authorization header, so this hook only fires for the
        // subprotocol-auth path — where authorizeWsUpgrade has already verified
        // that vt-bearer is the first value of the requested set.
        handleProtocols: (protocols: Set<string>): string | false =>
            protocols.has(VT_BEARER_SUBPROTOCOL) ? VT_BEARER_SUBPROTOCOL : false,
    })

    const tmuxAttach: TmuxAttachWiring = createTmuxAttachWiring()

    const server: Server = http.createServer(buildRequestHandler(
        options.catalog, options.hookHandler, hub, options.token, logger, options.readHealth,
    ))
    server.on('upgrade', buildUpgradeHandler(wss, tmuxAttach, hub, options.token, logger))

    const bindHost: string = options.bindHost ?? '0.0.0.0'
    const port: number = await new Promise<number>((resolveListen, rejectListen): void => {
        server.once('error', rejectListen)
        server.listen(options.port ?? 0, bindHost, (): void => {
            server.removeListener('error', rejectListen)
            const addr = server.address()
            if (!addr || typeof addr === 'string') {
                rejectListen(new Error('httpDaemonServer: no address after listen'))
                return
            }
            resolveListen(addr.port)
        })
    })

    const url: string = `http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${port}`
    logger.logRequest(`[httpDaemon] listening on ${url} (bind=${bindHost})`)

    return {
        port,
        url,
        hub,
        stop: (): Promise<void> => new Promise<void>((resolveStop, rejectStop): void => {
            void tmuxAttach.close().then((): void => {
                // Force-terminate active WebSocket clients and HTTP keep-alive
                // sockets before awaiting server.close(). wss.close() halts
                // new upgrades but leaves existing clients connected; without
                // this, server.close() blocks until each client's ping/idle
                // timer fires (~10s with the default ws keepalive). On
                // shutdown — including vault rebind — we are intentionally
                // dropping in-flight work, so a graceful drain has no value.
                for (const client of wss.clients) client.terminate()
                wss.close((): void => {
                    server.closeAllConnections()
                    server.close((cause?: Error): void => {
                        if (cause) rejectStop(cause)
                        else resolveStop()
                    })
                })
            })
        }),
    }
}
