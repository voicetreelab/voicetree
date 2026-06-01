// Headless HTTP daemon for graph-tools' live tooling. A minimal cousin of
// `@vt/vt-daemon`'s `startHttpDaemonServer` (no `/hook/:source`, no
// `/events` WS, no tmux relay). Serves `POST /rpc` with bearer-token auth and
// writes `<project>/.voicetree/rpc.port` + `auth-token` atomically so a sibling
// `liveTransport` client can discover it via the standard chain.
//
// Why not import `@vt/vt-daemon`'s server here: vt-daemon depends on
// `@vt/graph-tools/node`, so graph-tools cannot import vt-daemon at the
// package level without a runtime cycle. The HTTP server primitives needed
// for this headless data-layer-only daemon are small enough to live here;
// auth-token write + read share the canonical `@vt/vt-rpc` implementations.

import http, {type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {resolve} from 'node:path'

import {ERROR_CODES, generateAuthToken, writeAuthTokenFile, writeRpcPortFile} from '@vt/vt-rpc'

import {
    CatalogValidationError,
    type Catalog,
    type CatalogHandler,
    type HeadlessServer,
    type HeadlessServerOptions,
    type ToolResult,
} from './headlessServerTypes'
import {buildProjectLiveCatalog} from './projectLiveCatalog'

export {buildProjectLiveCatalog, CatalogValidationError}
export type {
    Catalog,
    CatalogHandler,
    HeadlessServer,
    HeadlessServerOptions,
    ToolResult,
} from './headlessServerTypes'

// ── wire helpers (single /rpc route, JSON-RPC 2.0, 64 KiB body cap) ──

const BODY_LIMIT_BYTES: number = 64 * 1024
const RPC_PATH: string = '/rpc'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
    const header: string | undefined = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) return false
    return header.slice('Bearer '.length).trim() === token
}

function readBodyWithCap(req: IncomingMessage): Promise<string | null> {
    return new Promise<string | null>((resolveBody, rejectBody): void => {
        const chunks: Buffer[] = []
        let total: number = 0
        let settled: boolean = false
        req.on('data', (chunk: Buffer): void => {
            if (settled) return
            total += chunk.length
            if (total > BODY_LIMIT_BYTES) {
                settled = true
                resolveBody(null)
                return
            }
            chunks.push(chunk)
        })
        req.on('end', (): void => {
            if (settled) return
            settled = true
            resolveBody(Buffer.concat(chunks).toString('utf8'))
        })
        req.on('error', (cause: Error): void => {
            if (settled) return
            settled = true
            rejectBody(cause)
        })
    })
}

function envelope(id: number | string | null, code: number, message: string, data?: unknown): unknown {
    return data === undefined
        ? {jsonrpc: '2.0', id, error: {code, message}}
        : {jsonrpc: '2.0', id, error: {code, message, data}}
}

async function dispatchRpcRequest(rawBody: string, catalog: Catalog): Promise<unknown> {
    let parsed: unknown
    try {
        parsed = JSON.parse(rawBody)
    } catch (cause) {
        return envelope(null, ERROR_CODES.parse_error, cause instanceof Error ? cause.message : 'Malformed JSON')
    }
    if (!isRecord(parsed) || parsed.jsonrpc !== '2.0') {
        return envelope(null, ERROR_CODES.invalid_request, 'Request must be a JSON-RPC 2.0 envelope')
    }
    const id: number | string | null = (typeof parsed.id === 'number' || typeof parsed.id === 'string') ? parsed.id : null
    const method: unknown = parsed.method
    if (typeof method !== 'string' || method.length === 0) {
        return envelope(id, ERROR_CODES.invalid_request, 'Request missing "method"')
    }
    const handler: CatalogHandler | undefined = catalog.get(method)
    if (!handler) {
        return envelope(id, ERROR_CODES.tool_not_found, `Unknown method: ${method}`)
    }
    const params: Record<string, unknown> = isRecord(parsed.params) ? parsed.params : {}
    let result: ToolResult
    try {
        result = await handler(params)
    } catch (cause) {
        if (cause instanceof CatalogValidationError) {
            return envelope(id, ERROR_CODES.validation_failed, cause.message, {
                kind: 'validation_failed', tool: cause.toolName, issues: cause.issues,
            })
        }
        return envelope(id, ERROR_CODES.internal_error, cause instanceof Error ? cause.message : String(cause))
    }
    if (result.ok) {
        return {jsonrpc: '2.0', id, result: result.payload}
    }
    return envelope(id, ERROR_CODES.tool_handler_failed, 'Tool handler returned an error response', result.payload)
}

async function handleRpc(req: IncomingMessage, res: ServerResponse, catalog: Catalog): Promise<void> {
    const body: string | null = await readBodyWithCap(req)
    if (body === null) {
        res.statusCode = 413
        res.end()
        return
    }
    const response: unknown = await dispatchRpcRequest(body, catalog)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
}

function buildRequestHandler(catalog: Catalog, token: string): http.RequestListener {
    return (req: IncomingMessage, res: ServerResponse): void => {
        if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
        }
        if (!isAuthorized(req, token)) {
            res.statusCode = 401
            res.end()
            return
        }
        if (req.method === 'POST' && req.url === RPC_PATH) {
            void handleRpc(req, res, catalog).catch((cause: unknown): void => {
                process.stderr.write(`[vt-headless] /rpc handler error: ${cause instanceof Error ? cause.message : String(cause)}\n`)
                if (!res.headersSent) {
                    res.statusCode = 500
                    res.end()
                }
            })
            return
        }
        res.statusCode = req.method === 'POST' ? 404 : 405
        res.end()
    }
}

// ── public API ────────────────────────────────────────────────────────────────

export async function createHeadlessServer(options: HeadlessServerOptions): Promise<HeadlessServer> {
    const projectPath: string = resolve(options.projectPath)
    const catalog: Catalog = options.catalog ?? await buildProjectLiveCatalog(projectPath)
    const token: string = generateAuthToken()
    const host: string = options.host ?? '127.0.0.1'

    await writeAuthTokenFile(projectPath, token)

    const server: Server = http.createServer(buildRequestHandler(catalog, token))
    const port: number = await new Promise<number>((resolveListen, rejectListen): void => {
        server.once('error', rejectListen)
        server.listen(options.port ?? 0, host, (): void => {
            server.removeListener('error', rejectListen)
            const addr = server.address()
            if (!addr || typeof addr === 'string') {
                rejectListen(new Error('createHeadlessServer: no address after listen'))
                return
            }
            resolveListen(addr.port)
        })
    })

    await writeRpcPortFile(projectPath, port)

    return {
        url: `http://${host}:${port}`,
        port,
        token,
        projectPath,
        close: (): Promise<void> => new Promise<void>((resolveClose, rejectClose): void => {
            server.close((cause?: Error): void => {
                if (cause) rejectClose(cause)
                else resolveClose()
            })
        }),
    }
}
