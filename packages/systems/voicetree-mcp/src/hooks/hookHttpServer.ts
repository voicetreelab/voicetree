/**
 * Dedicated hook-ingestion HTTP server. Single route, ~50 LOC, built directly
 * on `http.createServer` — no express, no MCP. Bound to 127.0.0.1 only (no
 * remote access). Lives alongside the daemon's UDS socket; isolation justified
 * because spawned hook scripts can only count on `curl` (design doc §2.4).
 *
 * Fail-quiet: malformed input, unknown source, or handler errors all respond
 * 200 with `{ok: false, ...}` so the hook subprocess never blocks the parent
 * agent.
 */

import http, {type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AgentEventKind} from '@vt/agent-runtime'
import {handleHookEventRequest, resolveHookEventName, type HookHandlerResponse} from './hookEventHandler'

export interface HookHttpServerHandle {
    readonly port: number
    readonly stop: () => Promise<void>
}

export interface StartHookHttpServerOptions {
    readonly updateAgentEvent: (terminalId: string, kind: AgentEventKind) => void
    /** Explicit port pin (tests). Default 0 = ephemeral assignment. */
    readonly port?: number
    readonly logger?: {
        readonly log: (message: string) => void
        readonly error: (message: string, error: unknown) => void
    }
}

const HOOK_ROUTE_PREFIX: string = '/hook/'
const MAX_BODY_BYTES: number = 64 * 1024 // hook payloads are tiny; cap to prevent abuse

function defaultLog(message: string): void {
    console.log(message)
}

function defaultError(message: string, error: unknown): void {
    console.error(message, error)
}

function respond(res: ServerResponse, payload: unknown): void {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(payload))
}

function parseQuery(rawUrl: string): {pathname: string; query: Record<string, string>} {
    const url: URL = new URL(rawUrl, 'http://127.0.0.1')
    const query: Record<string, string> = {}
    for (const [k, v] of url.searchParams) query[k] = v
    return {pathname: url.pathname, query}
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject): void => {
        let total: number = 0
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer): void => {
            total += chunk.length
            if (total > MAX_BODY_BYTES) {
                reject(new Error('hook payload exceeds 64 KiB'))
                req.destroy()
                return
            }
            chunks.push(chunk)
        })
        req.on('end', (): void => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
    })
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
    if (text.length === 0) return undefined
    try {
        const parsed: unknown = JSON.parse(text)
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : undefined
    } catch {
        return undefined
    }
}

async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    updateAgentEvent: (terminalId: string, kind: AgentEventKind) => void,
    logError: (message: string, error: unknown) => void,
): Promise<void> {
    if (req.method !== 'POST' || !req.url || !req.url.startsWith(HOOK_ROUTE_PREFIX)) {
        respond(res, {ok: false, reason: 'not_found'})
        return
    }

    const {pathname, query} = parseQuery(req.url)
    const source: string = pathname.slice(HOOK_ROUTE_PREFIX.length)

    let body: Record<string, unknown> | undefined
    try {
        body = tryParseJson(await readBody(req))
    } catch (cause) {
        logError('[hook] body read failed:', cause)
        respond(res, {ok: false, reason: 'body_read_failed'})
        return
    }

    try {
        const response: HookHandlerResponse = handleHookEventRequest(
            {
                source,
                terminalId: typeof query.terminal === 'string' ? query.terminal : undefined,
                hookEventName: resolveHookEventName(body, query),
            },
            {updateAgentEvent},
        )
        respond(res, response)
    } catch (cause) {
        logError('[hook] handler threw:', cause)
        respond(res, {ok: false, reason: 'exception'})
    }
}

export function startHookHttpServer(options: StartHookHttpServerOptions): Promise<HookHttpServerHandle> {
    const log: (message: string) => void = options.logger?.log ?? defaultLog
    const logError: (message: string, error: unknown) => void = options.logger?.error ?? defaultError

    const server: Server = http.createServer((req: IncomingMessage, res: ServerResponse): void => {
        void handleRequest(req, res, options.updateAgentEvent, logError)
    })

    return new Promise<HookHttpServerHandle>((resolveStart, rejectStart): void => {
        server.once('error', rejectStart)
        server.listen(options.port ?? 0, '127.0.0.1', (): void => {
            server.removeListener('error', rejectStart)
            const address: ReturnType<Server['address']> = server.address()
            if (!address || typeof address === 'string') {
                rejectStart(new Error('hookHttpServer failed to bind: no address'))
                return
            }
            log(`[hookHttpServer] listening on http://127.0.0.1:${address.port}`)
            resolveStart({
                port: address.port,
                stop: (): Promise<void> =>
                    new Promise<void>((resolveStop, rejectStop): void => {
                        server.close((cause: Error | undefined): void => {
                            if (cause) rejectStop(cause)
                            else resolveStop()
                        })
                    }),
            })
        })
    })
}
