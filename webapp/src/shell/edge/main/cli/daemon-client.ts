import net from 'node:net'
import {existsSync} from 'node:fs'
import {join, resolve} from 'node:path'

import {detectVaultFromCwd} from '@/shell/edge/main/cli/util/detectVault'

const VOICETREE_DIRNAME: string = '.voicetree'
const SOCKET_FILENAME: string = 'vt.sock'
const DEFAULT_RESPONSE_TIMEOUT_MS: number = 30_000

export class DaemonUnreachable extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'DaemonUnreachable'
    }
}

interface JsonRpcSuccess {
    jsonrpc: '2.0'
    id: number | string | null
    result: unknown
}

interface JsonRpcFailure {
    jsonrpc: '2.0'
    id: number | string | null
    error: {code: number; message: string; data?: unknown}
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function vaultPrimarySocketPath(vaultPath: string): string {
    return join(resolve(vaultPath), VOICETREE_DIRNAME, SOCKET_FILENAME)
}

// Path discovery — design doc §3.2 fallback order. First hit wins.
function resolveSocketPath(): string {
    const explicit: string | undefined = process.env.VOICETREE_SOCK_PATH
    if (explicit !== undefined && explicit.length > 0) {
        if (!existsSync(explicit)) {
            throw new DaemonUnreachable(
                `VOICETREE_SOCK_PATH=${explicit} does not exist. The override means "trust me, this is where it should be" — start the daemon there or unset the var.`,
            )
        }
        return explicit
    }

    const detected: string | null = detectVaultFromCwd()
    if (detected !== null) {
        return vaultPrimarySocketPath(detected)
    }

    const vaultEnv: string | undefined = process.env.VOICETREE_VAULT_PATH
    if (vaultEnv !== undefined && vaultEnv.length > 0) {
        return vaultPrimarySocketPath(vaultEnv)
    }

    throw new DaemonUnreachable(
        'Cannot resolve daemon socket: no vault found via up-walk and $VOICETREE_VAULT_PATH is unset.',
    )
}

function getTimeoutMs(): number {
    const raw: string | undefined = process.env.VOICETREE_DAEMON_TIMEOUT_MS
    if (raw === undefined) return DEFAULT_RESPONSE_TIMEOUT_MS
    const parsed: number = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESPONSE_TIMEOUT_MS
}

// Framing helper — newline-delimited JSON. Isolated so a future swap to
// length-prefixed framing (design doc §4.2) is a single-function change.
function writeNdjsonFrame(socket: net.Socket, envelope: object): void {
    socket.write(`${JSON.stringify(envelope)}\n`)
}

function parseNdjsonResponse(buffer: string): JsonRpcResponse {
    const newlineIndex: number = buffer.indexOf('\n')
    const frame: string = newlineIndex >= 0 ? buffer.slice(0, newlineIndex) : buffer.trimEnd()
    if (frame.length === 0) {
        throw new Error('Daemon returned an empty response')
    }
    const parsed: unknown = JSON.parse(frame)
    if (!isRecord(parsed) || parsed.jsonrpc !== '2.0') {
        throw new Error('Daemon returned a non-JSON-RPC response')
    }
    return parsed as unknown as JsonRpcResponse
}

function rpcRequest(method: string, params: Record<string, unknown>, id: number): object {
    return {jsonrpc: '2.0', method, params, id}
}

async function sendRpc(socketPath: string, request: object): Promise<JsonRpcResponse> {
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

        const finish = (response: JsonRpcResponse | Error): void => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            socket.destroy()
            if (response instanceof Error) rejectCall(response)
            else resolveCall(response)
        }

        socket.setEncoding('utf8')
        socket.on('connect', (): void => {
            writeNdjsonFrame(socket, request)
        })
        socket.on('data', (chunk: string): void => {
            buffer += chunk
            if (buffer.includes('\n')) {
                try {
                    finish(parseNdjsonResponse(buffer))
                } catch (cause) {
                    finish(cause instanceof Error ? cause : new Error(String(cause)))
                }
            }
        })
        socket.on('end', (): void => {
            if (settled) return
            // Server closed before a full frame arrived — treat buffered bytes
            // as the response if non-empty, else surface as a hard error.
            if (buffer.trimEnd().length > 0) {
                try {
                    finish(parseNdjsonResponse(buffer))
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

let requestSequence: number = 0
function nextRequestId(): number {
    requestSequence += 1
    return requestSequence
}

// Preserves the contract callers used to have against mcp-client.ts:
//   - returns the parsed tool payload on success
//   - throws Error with message = JSON-stringified payload when the tool
//     handler reports failure (code -32003)
//   - throws Error with rpc.message for other JSON-RPC errors
//   - throws DaemonUnreachable when the socket isn't there
export async function callDaemon(
    toolName: string,
    args: Record<string, unknown>,
): Promise<unknown> {
    const socketPath: string = resolveSocketPath()
    const response: JsonRpcResponse = await sendRpc(socketPath, rpcRequest(toolName, args, nextRequestId()))

    if ('error' in response) {
        if (response.error.code === -32003 && response.error.data !== undefined) {
            throw new Error(JSON.stringify(response.error.data))
        }
        throw new Error(response.error.message)
    }

    return response.result
}
