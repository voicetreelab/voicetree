// UDS JSON-RPC client for the daemon's live tools (vt_get_live_state,
// vt_dispatch_live_command). Same `LiveTransport` interface as before; only the
// wire changed (was MCP-over-HTTP, now NDJSON JSON-RPC over a Unix domain
// socket — design doc §3, §4).
//
// Path-discovery and NDJSON framing intentionally mirror the convention used
// by webapp/src/shell/edge/main/cli/daemon-client.ts. The shared primitives
// live in `@vt/voicetree-mcp/src/transport/socketPath.ts`, but `graph-tools`
// cannot import that package without creating a dependency cycle
// (voicetree-mcp already imports `@vt/graph-tools/node`). 7g may consolidate
// the conventions into a deeper transport library; until then this duplication
// is the honest cycle-free option.
import net from 'node:net'
import {existsSync, statSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'

import {hydrateState, serializeCommand, type SerializedState} from '@vt/graph-state'
import type {Command, Delta, State} from '@vt/graph-state/contract'

const VOICETREE_DIRNAME: string = '.voicetree'
const SOCKET_FILENAME: string = 'vt.sock'
const DEFAULT_RESPONSE_TIMEOUT_MS: number = 30_000

export class DaemonUnreachable extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'DaemonUnreachable'
    }
}

interface SerializableDelta {
    readonly revision: number
    readonly cause: unknown
    readonly collapseAdded?: readonly string[]
    readonly collapseRemoved?: readonly string[]
    readonly selectionAdded?: readonly string[]
    readonly selectionRemoved?: readonly string[]
    readonly rootsLoaded?: readonly string[]
    readonly rootsUnloaded?: readonly string[]
    readonly positionsMoved?: readonly (readonly [string, {x: number; y: number}])[]
    readonly layoutChanged?: {
        readonly zoom?: number
        readonly pan?: {x: number; y: number}
        readonly positions?: readonly (readonly [string, {x: number; y: number}])[]
        readonly fit?: {readonly paddingPx: number} | null
    }
}

interface DispatchResult {
    readonly delta: SerializableDelta
    readonly revision: number
}

export interface LiveTransport {
    readonly getLiveState: () => Promise<State>
    readonly dispatchLiveCommand: (cmd: Command) => Promise<Delta>
}

// ── Path discovery (design doc §3.2 fallback order) ────────────────────────

function vaultSocketPath(vaultPath: string): string {
    return join(resolve(vaultPath), VOICETREE_DIRNAME, SOCKET_FILENAME)
}

function hasVoicetreeMarker(candidatePath: string): boolean {
    try {
        return statSync(join(candidatePath, VOICETREE_DIRNAME)).isDirectory()
    } catch {
        return false
    }
}

function detectVaultFromCwd(cwd: string = process.cwd()): string | null {
    let current: string = resolve(cwd)
    for (;;) {
        if (hasVoicetreeMarker(current)) return current
        const parent: string = dirname(current)
        if (parent === current) return null
        current = parent
    }
}

function resolveSocketPath(explicitVault?: string): string {
    const envSock: string | undefined = process.env.VOICETREE_SOCK_PATH
    if (envSock !== undefined && envSock.length > 0) {
        if (!existsSync(envSock)) {
            throw new DaemonUnreachable(
                `VOICETREE_SOCK_PATH=${envSock} does not exist. The override means "trust me, this is where it should be" — start the daemon there or unset the var.`,
            )
        }
        return envSock
    }

    if (explicitVault !== undefined && explicitVault.length > 0) {
        return vaultSocketPath(explicitVault)
    }

    const detected: string | null = detectVaultFromCwd()
    if (detected !== null) return vaultSocketPath(detected)

    const vaultEnv: string | undefined = process.env.VOICETREE_VAULT_PATH
    if (vaultEnv !== undefined && vaultEnv.length > 0) {
        return vaultSocketPath(vaultEnv)
    }

    throw new DaemonUnreachable(
        'Cannot resolve daemon socket: no vault found via up-walk and no $VOICETREE_VAULT_PATH set. Pass a vault path or set $VOICETREE_SOCK_PATH.',
    )
}

// ── NDJSON framing (isolated per design doc §4.2) ──────────────────────────

function writeNdjsonFrame(socket: net.Socket, envelope: object): void {
    socket.write(`${JSON.stringify(envelope)}\n`)
}

interface JsonRpcSuccess {readonly jsonrpc: '2.0'; readonly id: number | string | null; readonly result: unknown}
interface JsonRpcFailure {readonly jsonrpc: '2.0'; readonly id: number | string | null; readonly error: {readonly code: number; readonly message: string; readonly data?: unknown}}
type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseFrame(frame: string): JsonRpcResponse {
    const parsed: unknown = JSON.parse(frame)
    if (!isRecord(parsed) || parsed.jsonrpc !== '2.0') {
        throw new Error('Daemon returned a non-JSON-RPC response')
    }
    return parsed as unknown as JsonRpcResponse
}

function getTimeoutMs(): number {
    const raw: string | undefined = process.env.VOICETREE_DAEMON_TIMEOUT_MS
    if (raw === undefined) return DEFAULT_RESPONSE_TIMEOUT_MS
    const parsed: number = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESPONSE_TIMEOUT_MS
}

let requestSequence: number = 0
function nextRequestId(): number {
    requestSequence += 1
    return requestSequence
}

async function sendRpc(
    socketPath: string,
    method: string,
    params: Record<string, unknown>,
): Promise<JsonRpcResponse> {
    const request: object = {jsonrpc: '2.0', method, params, id: nextRequestId()}

    return new Promise<JsonRpcResponse>((resolveCall, rejectCall): void => {
        const socket: net.Socket = net.createConnection({path: socketPath})
        let buffer: string = ''
        let settled: boolean = false

        const timer: NodeJS.Timeout = setTimeout((): void => {
            if (settled) return
            settled = true
            socket.destroy()
            rejectCall(new DaemonUnreachable(
                `Daemon did not respond within ${getTimeoutMs()}ms (socket ${socketPath}). Override with $VOICETREE_DAEMON_TIMEOUT_MS.`,
            ))
        }, getTimeoutMs())

        const finish = (outcome: JsonRpcResponse | Error): void => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            socket.destroy()
            if (outcome instanceof Error) rejectCall(outcome)
            else resolveCall(outcome)
        }

        socket.setEncoding('utf8')
        socket.on('connect', (): void => {
            writeNdjsonFrame(socket, request)
        })
        socket.on('data', (chunk: string): void => {
            buffer += chunk
            const newlineIndex: number = buffer.indexOf('\n')
            if (newlineIndex >= 0) {
                try {
                    finish(parseFrame(buffer.slice(0, newlineIndex)))
                } catch (cause) {
                    finish(cause instanceof Error ? cause : new Error(String(cause)))
                }
            }
        })
        socket.on('end', (): void => {
            if (settled) return
            if (buffer.trimEnd().length > 0) {
                try {
                    finish(parseFrame(buffer.trimEnd()))
                } catch (cause) {
                    finish(cause instanceof Error ? cause : new Error(String(cause)))
                }
                return
            }
            finish(new Error(`Daemon closed connection without responding (socket ${socketPath})`))
        })
        socket.on('error', (cause: NodeJS.ErrnoException): void => {
            if (cause.code === 'ENOENT' || cause.code === 'ECONNREFUSED' || cause.code === 'ENOTSOCK') {
                finish(new DaemonUnreachable(
                    `No daemon listening at ${socketPath}. Start vt-mcpd or open the vault in Voicetree.`,
                ))
                return
            }
            finish(cause)
        })
    })
}

// Tool-handler failures (code -32003) carry the original `{error: "..."}`
// payload in `data`; surface that string so callers see the operational
// reason (e.g. "No vault loaded yet").
function toolErrorMessage(failure: JsonRpcFailure, method: string): string {
    const data: unknown = failure.error.data
    if (failure.error.code === -32003 && isRecord(data) && typeof data.error === 'string') {
        return `${method} returned error: ${data.error}`
    }
    return `${method} failed (code ${failure.error.code}): ${failure.error.message}`
}

async function callTool<T>(
    socketPath: string,
    method: string,
    params: Record<string, unknown>,
): Promise<T> {
    const response: JsonRpcResponse = await sendRpc(socketPath, method, params)
    if ('error' in response) {
        throw new Error(toolErrorMessage(response, method))
    }
    return response.result as T
}

function hydrateDelta(serialized: SerializableDelta, cause: Command): Delta {
    return {
        revision: serialized.revision,
        cause,
        ...(serialized.collapseAdded ? {collapseAdded: serialized.collapseAdded} : {}),
        ...(serialized.collapseRemoved ? {collapseRemoved: serialized.collapseRemoved} : {}),
        ...(serialized.selectionAdded ? {selectionAdded: serialized.selectionAdded} : {}),
        ...(serialized.selectionRemoved ? {selectionRemoved: serialized.selectionRemoved} : {}),
        ...(serialized.rootsLoaded ? {rootsLoaded: serialized.rootsLoaded} : {}),
        ...(serialized.rootsUnloaded ? {rootsUnloaded: serialized.rootsUnloaded} : {}),
        ...(serialized.positionsMoved ? {positionsMoved: new Map(serialized.positionsMoved)} : {}),
        ...(serialized.layoutChanged
            ? {
                layoutChanged: {
                    ...(serialized.layoutChanged.zoom !== undefined ? {zoom: serialized.layoutChanged.zoom} : {}),
                    ...(serialized.layoutChanged.pan !== undefined ? {pan: serialized.layoutChanged.pan} : {}),
                    ...(serialized.layoutChanged.positions !== undefined
                        ? {positions: new Map(serialized.layoutChanged.positions)}
                        : {}),
                    ...(serialized.layoutChanged.fit !== undefined ? {fit: serialized.layoutChanged.fit} : {}),
                },
            }
            : {}),
    }
}

// ── public API ─────────────────────────────────────────────────────────────

export function createLiveTransport(vaultPath?: string): LiveTransport {
    const socketPath: string = resolveSocketPath(vaultPath)
    return {
        async getLiveState(): Promise<State> {
            const serialized: SerializedState = await callTool<SerializedState>(
                socketPath,
                'vt_get_live_state',
                {},
            )
            return hydrateState(serialized)
        },

        async dispatchLiveCommand(cmd: Command): Promise<Delta> {
            const serialized = serializeCommand(cmd)
            const result: DispatchResult = await callTool<DispatchResult>(
                socketPath,
                'vt_dispatch_live_command',
                {command: serialized},
            )
            return hydrateDelta(result.delta, cmd)
        },
    }
}
