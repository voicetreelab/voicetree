// UDS (Unix Domain Socket) JSON-RPC server.
// Pin: framing helper (`writeNdjsonFrame`/`readNdjsonFrames`) is intentionally
// isolated so a future swap to length-prefixed framing is mechanical
// (design doc §4.2).

import net from 'node:net'
import {existsSync, unlinkSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'

import type {McpToolResponse} from '../tools/toolResponse'
import {CatalogValidationError} from '../tools/catalog'

export type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResponse>
export type ToolCatalog = ReadonlyMap<string, ToolHandler>

export interface UdsServerHandle {
    readonly socketPath: string
    readonly stop: () => Promise<void>
}

export interface StartUdsServerOptions {
    readonly socketPath: string
    readonly catalog: ToolCatalog
    readonly logger?: {
        readonly log: (message: string) => void
        readonly error: (message: string, error: unknown) => void
    }
}

const ERROR_CODES = {
    parse_error: -32700,
    invalid_request: -32600,
    tool_not_found: -32601,
    validation_failed: -32602,
    internal_error: -32603,
    tool_handler_failed: -32003,
} as const

type JsonRpcRequest = {
    readonly jsonrpc: '2.0'
    readonly method?: unknown
    readonly params?: unknown
    readonly id?: unknown
}

type JsonRpcResponse =
    | {jsonrpc: '2.0'; id: number | string | null; result: unknown}
    | {jsonrpc: '2.0'; id: number | string | null; error: {code: number; message: string; data?: unknown}}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function defaultLog(message: string): void {
    console.log(message)
}

function defaultError(message: string, error: unknown): void {
    console.error(message, error)
}

function unwrapToolResponse(response: McpToolResponse): {ok: true; payload: unknown} | {ok: false; payload: unknown} {
    const text: string = response.content[0]?.text ?? ''
    let payload: unknown
    try {
        payload = text === '' ? null : JSON.parse(text)
    } catch {
        payload = text
    }

    return response.isError === true
        ? {ok: false, payload}
        : {ok: true, payload}
}

async function dispatchRequest(
    request: JsonRpcRequest,
    catalog: ToolCatalog,
): Promise<JsonRpcResponse> {
    const id: number | string | null = (typeof request.id === 'number' || typeof request.id === 'string')
        ? request.id
        : null
    const method: unknown = request.method
    if (typeof method !== 'string' || method.length === 0) {
        return {
            jsonrpc: '2.0',
            id,
            error: {code: ERROR_CODES.invalid_request, message: 'Request missing "method"'},
        }
    }

    const handler: ToolHandler | undefined = catalog.get(method)
    if (!handler) {
        return {
            jsonrpc: '2.0',
            id,
            error: {code: ERROR_CODES.tool_not_found, message: `Unknown method: ${method}`},
        }
    }

    const params: Record<string, unknown> = isRecord(request.params) ? request.params : {}
    let response: McpToolResponse
    try {
        response = await handler(params)
    } catch (cause) {
        if (cause instanceof CatalogValidationError) {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: ERROR_CODES.validation_failed,
                    message: cause.message,
                    data: {kind: 'validation_failed', tool: cause.toolName, issues: cause.issues},
                },
            }
        }
        return {
            jsonrpc: '2.0',
            id,
            error: {
                code: ERROR_CODES.internal_error,
                message: cause instanceof Error ? cause.message : String(cause),
            },
        }
    }

    const unwrapped: {ok: boolean; payload: unknown} = unwrapToolResponse(response)
    if (unwrapped.ok) {
        return {jsonrpc: '2.0', id, result: unwrapped.payload}
    }
    return {
        jsonrpc: '2.0',
        id,
        error: {
            code: ERROR_CODES.tool_handler_failed,
            message: 'Tool handler returned an error response',
            data: unwrapped.payload,
        },
    }
}

// Framing helper — isolated so a future swap to length-prefixed framing
// (design doc §4.2) is a single-function change.
function writeNdjsonFrame(socket: net.Socket, envelope: JsonRpcResponse): void {
    socket.write(`${JSON.stringify(envelope)}\n`)
}

function* readNdjsonFrames(buffer: {value: string}): Generator<string, void, void> {
    let newlineIndex: number = buffer.value.indexOf('\n')
    while (newlineIndex >= 0) {
        const frame: string = buffer.value.slice(0, newlineIndex)
        buffer.value = buffer.value.slice(newlineIndex + 1)
        yield frame
        newlineIndex = buffer.value.indexOf('\n')
    }
}

function handleConnection(socket: net.Socket, catalog: ToolCatalog, logError: (m: string, e: unknown) => void): void {
    const buffer: {value: string} = {value: ''}

    socket.setEncoding('utf8')
    socket.on('data', (chunk: string): void => {
        buffer.value += chunk
        for (const frame of readNdjsonFrames(buffer)) {
            void processFrame(frame, socket, catalog, logError)
        }
    })

    socket.on('error', (cause: Error): void => {
        // EPIPE on client disconnect mid-write is benign; we close anyway.
        const code: string | undefined = (cause as NodeJS.ErrnoException).code
        if (code !== 'EPIPE' && code !== 'ECONNRESET') {
            logError('[udsServer] socket error:', cause)
        }
    })
}

async function processFrame(
    frame: string,
    socket: net.Socket,
    catalog: ToolCatalog,
    logError: (m: string, e: unknown) => void,
): Promise<void> {
    let request: JsonRpcRequest
    try {
        const parsed: unknown = JSON.parse(frame)
        if (!isRecord(parsed)) {
            writeNdjsonFrame(socket, {
                jsonrpc: '2.0',
                id: null,
                error: {code: ERROR_CODES.invalid_request, message: 'Request must be a JSON object'},
            })
            socket.end()
            return
        }
        request = parsed as JsonRpcRequest
    } catch (cause) {
        writeNdjsonFrame(socket, {
            jsonrpc: '2.0',
            id: null,
            error: {
                code: ERROR_CODES.parse_error,
                message: cause instanceof Error ? cause.message : 'Malformed JSON',
            },
        })
        socket.end()
        return
    }

    let response: JsonRpcResponse
    try {
        response = await dispatchRequest(request, catalog)
    } catch (cause) {
        logError('[udsServer] dispatch threw:', cause)
        response = {
            jsonrpc: '2.0',
            id: typeof request.id === 'number' || typeof request.id === 'string' ? request.id : null,
            error: {
                code: ERROR_CODES.internal_error,
                message: cause instanceof Error ? cause.message : String(cause),
            },
        }
    }

    writeNdjsonFrame(socket, response)
    socket.end()
}

// Stale socket cleanup (design doc §3.3): if the socket file exists but no
// process answers a probe connect, the previous daemon crashed without
// unlinking — delete the file and bind cleanly. If a process IS listening,
// abort (single-owner contract, mirrors graphd.lock semantics).
async function clearStaleSocket(socketPath: string): Promise<void> {
    if (!existsSync(socketPath)) return

    await new Promise<void>((resolveCheck, rejectCheck): void => {
        const probe: net.Socket = net.createConnection({path: socketPath})
        probe.once('connect', (): void => {
            probe.end()
            rejectCheck(new Error(
                `Another process is already listening on ${socketPath}. Stop it before binding.`,
            ))
        })
        probe.once('error', (cause: NodeJS.ErrnoException): void => {
            if (cause.code === 'ECONNREFUSED' || cause.code === 'ENOENT' || cause.code === 'ENOTSOCK') {
                try {
                    unlinkSync(socketPath)
                    resolveCheck()
                } catch (unlinkCause) {
                    rejectCheck(unlinkCause instanceof Error ? unlinkCause : new Error(String(unlinkCause)))
                }
                return
            }
            rejectCheck(cause)
        })
    })
}

export async function startUdsServer(options: StartUdsServerOptions): Promise<UdsServerHandle> {
    const log: (message: string) => void = options.logger?.log ?? defaultLog
    const logError: (message: string, error: unknown) => void = options.logger?.error ?? defaultError

    await mkdir(dirname(options.socketPath), {recursive: true})
    await clearStaleSocket(options.socketPath)

    const server: net.Server = net.createServer((socket: net.Socket): void => {
        handleConnection(socket, options.catalog, logError)
    })

    await new Promise<void>((resolveListen, rejectListen): void => {
        server.once('error', rejectListen)
        server.listen(options.socketPath, (): void => {
            server.removeListener('error', rejectListen)
            resolveListen()
        })
    })

    log(`[udsServer] listening on ${options.socketPath}`)

    return {
        socketPath: options.socketPath,
        stop: (): Promise<void> =>
            new Promise<void>((resolveClose, rejectClose): void => {
                server.close((cause: Error | undefined): void => {
                    if (cause) {
                        rejectClose(cause)
                        return
                    }
                    if (existsSync(options.socketPath)) {
                        try {
                            unlinkSync(options.socketPath)
                        } catch {
                            // best-effort; another process may have cleaned up
                        }
                    }
                    resolveClose()
                })
            }),
    }
}
