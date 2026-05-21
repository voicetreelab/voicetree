/**
 * BF-188 — data-layer-only daemon (headless).
 *
 * No Electron, no cytoscape, no UI. Hosts vt_get_live_state +
 * vt_dispatch_live_command on a Unix domain socket (Step 7c). Used by
 * `vt-headless serve` and as a test fixture for the live tooling.
 *
 * The UDS framing here is the same NDJSON JSON-RPC the daemon speaks; we
 * duplicate the server-side bytes because graph-tools cannot import
 * @vt/voicetree-mcp without creating a runtime dependency cycle. 7g may
 * consolidate the transport primitives into a shared package.
 */
import net from 'node:net'
import {existsSync, unlinkSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {
    emptyState,
    buildStateFromVault,
    serializeState,
    hydrateCommand,
    applyCommandWithDelta,
    type SerializedCommand,
} from '@vt/graph-state'
import type {State, Delta} from '@vt/graph-state/contract'
import {configureGraphToolsRootIO} from './rootIO'

// ── delta serialization (shape liveTransport.ts DispatchResult expects) ───────

interface SerializableDelta {
    readonly revision: number
    readonly cause: unknown
    readonly collapseAdded?: readonly string[]
    readonly collapseRemoved?: readonly string[]
    readonly selectionAdded?: readonly string[]
    readonly selectionRemoved?: readonly string[]
    readonly rootsLoaded?: readonly string[]
    readonly rootsUnloaded?: readonly string[]
}

function toSerializableDelta(delta: Delta, cause: SerializedCommand): SerializableDelta {
    return {
        revision: delta.revision,
        cause,
        ...(delta.collapseAdded ? {collapseAdded: [...delta.collapseAdded]} : {}),
        ...(delta.collapseRemoved ? {collapseRemoved: [...delta.collapseRemoved]} : {}),
        ...(delta.selectionAdded ? {selectionAdded: [...delta.selectionAdded]} : {}),
        ...(delta.selectionRemoved ? {selectionRemoved: [...delta.selectionRemoved]} : {}),
        ...(delta.rootsLoaded ? {rootsLoaded: [...delta.rootsLoaded]} : {}),
        ...(delta.rootsUnloaded ? {rootsUnloaded: [...delta.rootsUnloaded]} : {}),
    }
}

// ── JSON-RPC envelope helpers ─────────────────────────────────────────────────

type JsonRpcResponse =
    | {jsonrpc: '2.0'; id: number | string | null; result: unknown}
    | {jsonrpc: '2.0'; id: number | string | null; error: {code: number; message: string; data?: unknown}}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeFrame(socket: net.Socket, envelope: JsonRpcResponse): void {
    socket.write(`${JSON.stringify(envelope)}\n`)
}

// ── tool handlers ─────────────────────────────────────────────────────────────

type ToolResult = {ok: true; payload: unknown} | {ok: false; payload: unknown}

function runGetLiveState(getState: () => State): ToolResult {
    try {
        return {ok: true, payload: serializeState(getState())}
    } catch (error) {
        return {ok: false, payload: {error: error instanceof Error ? error.message : String(error)}}
    }
}

function runDispatchLiveCommand(
    getState: () => State,
    setState: (state: State) => void,
    args: Record<string, unknown>,
): ToolResult {
    try {
        const serializedCommand = args.command as SerializedCommand
        const cmd = hydrateCommand(serializedCommand)
        const {state, delta} = applyCommandWithDelta(getState(), cmd)
        setState(state)
        return {
            ok: true,
            payload: {
                delta: toSerializableDelta(delta, serializedCommand),
                revision: delta.revision,
            },
        }
    } catch (error) {
        return {ok: false, payload: {error: error instanceof Error ? error.message : String(error)}}
    }
}

async function dispatch(
    method: string,
    params: Record<string, unknown>,
    getState: () => State,
    setState: (state: State) => void,
): Promise<ToolResult | null> {
    if (method === 'vt_get_live_state') return runGetLiveState(getState)
    if (method === 'vt_dispatch_live_command') return runDispatchLiveCommand(getState, setState, params)
    return null
}

// ── connection handler ────────────────────────────────────────────────────────

function handleConnection(
    socket: net.Socket,
    getState: () => State,
    setState: (state: State) => void,
): void {
    socket.setEncoding('utf8')
    let buffer: string = ''

    const handleFrame = async (frame: string): Promise<void> => {
        let request: {method?: unknown; params?: unknown; id?: unknown}
        const idOrNull = (raw: unknown): number | string | null =>
            (typeof raw === 'number' || typeof raw === 'string') ? raw : null

        try {
            const parsed: unknown = JSON.parse(frame)
            if (!isRecord(parsed)) {
                writeFrame(socket, {jsonrpc: '2.0', id: null, error: {code: -32600, message: 'Invalid request'}})
                socket.end()
                return
            }
            request = parsed
        } catch (cause) {
            writeFrame(socket, {
                jsonrpc: '2.0', id: null,
                error: {code: -32700, message: cause instanceof Error ? cause.message : 'Malformed JSON'},
            })
            socket.end()
            return
        }

        const id = idOrNull(request.id)
        const method = typeof request.method === 'string' ? request.method : ''
        if (!method) {
            writeFrame(socket, {jsonrpc: '2.0', id, error: {code: -32600, message: 'Missing method'}})
            socket.end()
            return
        }

        const params: Record<string, unknown> = isRecord(request.params) ? request.params : {}
        const result = await dispatch(method, params, getState, setState)
        if (result === null) {
            writeFrame(socket, {jsonrpc: '2.0', id, error: {code: -32601, message: `Unknown method: ${method}`}})
            socket.end()
            return
        }

        if (result.ok) {
            writeFrame(socket, {jsonrpc: '2.0', id, result: result.payload})
        } else {
            writeFrame(socket, {
                jsonrpc: '2.0', id,
                error: {code: -32003, message: 'Tool handler returned an error response', data: result.payload},
            })
        }
        socket.end()
    }

    socket.on('data', (chunk: string): void => {
        buffer += chunk
        let newlineIndex: number = buffer.indexOf('\n')
        while (newlineIndex >= 0) {
            const frame: string = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            void handleFrame(frame)
            newlineIndex = buffer.indexOf('\n')
        }
    })

    socket.on('error', (cause: NodeJS.ErrnoException): void => {
        if (cause.code !== 'EPIPE' && cause.code !== 'ECONNRESET') {
            process.stderr.write(`[vt-headless] socket error: ${cause.message}\n`)
        }
    })
}

// ── public API ────────────────────────────────────────────────────────────────

export interface HeadlessServerOptions {
    readonly socketPath: string
    readonly vaultPath?: string
}

export interface HeadlessServer {
    readonly socketPath: string
    readonly close: () => Promise<void>
}

async function clearStaleSocket(socketPath: string): Promise<void> {
    if (!existsSync(socketPath)) return
    await new Promise<void>((resolveCheck, rejectCheck): void => {
        const probe: net.Socket = net.createConnection({path: socketPath})
        probe.once('connect', (): void => {
            probe.end()
            rejectCheck(new Error(`Another process is already listening on ${socketPath}.`))
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

export async function createHeadlessServer(options: HeadlessServerOptions): Promise<HeadlessServer> {
    configureGraphToolsRootIO()

    let state: State = emptyState()
    if (options.vaultPath) {
        const resolved = resolve(options.vaultPath)
        state = await buildStateFromVault(resolved, resolved)
    }

    await mkdir(dirname(options.socketPath), {recursive: true})
    await clearStaleSocket(options.socketPath)

    const server: net.Server = net.createServer((socket: net.Socket): void => {
        handleConnection(socket, () => state, (s: State) => { state = s })
    })

    await new Promise<void>((resolveListen, rejectListen): void => {
        server.once('error', rejectListen)
        server.listen(options.socketPath, (): void => {
            server.removeListener('error', rejectListen)
            resolveListen()
        })
    })

    return {
        socketPath: options.socketPath,
        close: (): Promise<void> => new Promise<void>((resolveClose, rejectClose): void => {
            server.close((cause?: Error): void => {
                if (cause) {
                    rejectClose(cause)
                    return
                }
                if (existsSync(options.socketPath)) {
                    try { unlinkSync(options.socketPath) } catch { /* best effort */ }
                }
                resolveClose()
            })
        }),
    }
}
