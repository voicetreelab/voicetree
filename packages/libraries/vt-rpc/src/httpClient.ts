// JSON-RPC 2.0 over HTTP POST client for the VoiceTree daemon. One request
// per call, single JSON envelope in the body. Bearer token auth in the
// `Authorization` header. Wire pinned in design doc §4.1 / §4.2.
//
// HTTP-layer failure modes map to client-side synthetic JSON-RPC errors so
// callers handle a uniform shape:
//   - 401              → DaemonAuthRequired (auth_required, -32004)
//   - network failure  → DaemonUnreachable  (daemon_unreachable, -32000)
//
// JSON-RPC errors (in the response body with HTTP 200) pass through verbatim
// — including CLI-layer envelopes that ride in `error.data`.

import {readAuthTokenFile, redactToken} from './authTokenFile.ts'
import {ERROR_CODES} from './errorCodes.ts'
import {
    discoverDaemonEndpoint,
    discoverDaemonEndpointForProject,
    type ResolvedDaemonEndpoint,
} from './pathDiscovery.ts'

const DEFAULT_TIMEOUT_MS: number = 30_000

export class DaemonUnreachable extends Error {
    readonly code: number = ERROR_CODES.daemon_unreachable
    constructor(message: string) {
        super(message)
        this.name = 'DaemonUnreachable'
    }
}

export class DaemonAuthRequired extends Error {
    readonly code: number = ERROR_CODES.auth_required
    constructor(message: string) {
        super(message)
        this.name = 'DaemonAuthRequired'
    }
}

interface JsonRpcSuccess {
    readonly jsonrpc: '2.0'
    readonly id: number | string | null
    readonly result: unknown
}

interface JsonRpcFailure {
    readonly jsonrpc: '2.0'
    readonly id: number | string | null
    readonly error: {readonly code: number; readonly message: string; readonly data?: unknown}
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getTimeoutMs(env: Record<string, string | undefined>): number {
    const raw: string | undefined = env.VOICETREE_DAEMON_TIMEOUT_MS
    if (raw === undefined) return DEFAULT_TIMEOUT_MS
    const parsed: number = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

export interface DaemonRpcClient {
    readonly call: (method: string, params: Record<string, unknown>, id?: number | string) => Promise<JsonRpcResponse>
    readonly endpoint: ResolvedDaemonEndpoint
    readonly token: string
}

// Reader env (Pattern 3) for the RPC layer: `cwd` and `env` are required
// inputs. The discovery + auth chain reads VOICETREE_* env vars and the
// cwd up-walk; callers thread those values in from the shell boundary so
// the layer stays free of the transitive-purity gate.
export interface CreateRpcClientOptions {
    readonly cwd: string
    readonly env: Record<string, string | undefined>
}

// Resolve daemon URL + token via the discovery chain. Throws
// `DaemonUnreachable` when no endpoint resolves or the token file is missing
// at the resolved project.
export async function createRpcClient(options: CreateRpcClientOptions): Promise<DaemonRpcClient> {
    const {env, cwd} = options
    const endpoint: ResolvedDaemonEndpoint | null = await discoverDaemonEndpoint({cwd, env})
    if (!endpoint) {
        throw new DaemonUnreachable(
            'Cannot resolve VoiceTree daemon URL. Set $VOICETREE_DAEMON_URL, open a project, or set $VOICETREE_PROJECT_PATH.',
        )
    }
    return buildClientFromEndpoint(endpoint, env)
}

export interface CreateRpcClientForProjectOptions {
    readonly env: Record<string, string | undefined>
}

// Explicit-project client construction. Skips the cwd up-walk and reads
// rpc.port + auth-token directly from the named project. `$VOICETREE_DAEMON_URL`
// still wins (per-process override), but the token always comes from the
// explicit project. Used by graph-tools' `createLiveTransport(projectPath)`;
// replaces the 9d `createRpcClient({cwd: '/'})` workaround.
export async function createRpcClientForProject(
    projectPath: string,
    options: CreateRpcClientForProjectOptions,
): Promise<DaemonRpcClient> {
    if (projectPath.length === 0) {
        throw new DaemonUnreachable('createRpcClientForProject: projectPath must be a non-empty path.')
    }
    const {env} = options
    const endpoint: ResolvedDaemonEndpoint | null = await discoverDaemonEndpointForProject(projectPath, {env})
    if (!endpoint) {
        throw new DaemonUnreachable(
            `No daemon for project ${projectPath}: rpc.port not found at ${projectPath}/.voicetree/rpc.port and $VOICETREE_DAEMON_URL is unset.`,
        )
    }
    return buildClientFromEndpoint(endpoint, env)
}

async function buildClientFromEndpoint(
    endpoint: ResolvedDaemonEndpoint,
    env: Record<string, string | undefined>,
): Promise<DaemonRpcClient> {
    const tokenSource: string | null = endpoint.projectPath
    const token: string | null = tokenSource ? await readAuthTokenFile(tokenSource) : null
    if (token === null) {
        throw new DaemonUnreachable(
            `No auth token at ${tokenSource ?? '<unknown project>'}/.voicetree/auth-token. Daemon may not be running, or project path is wrong.`,
        )
    }
    return {
        call: (method, params, id) => callDaemon(endpoint.url, token, method, params, id, env),
        endpoint,
        token,
    }
}

async function callDaemon(
    url: string,
    token: string,
    method: string,
    params: Record<string, unknown>,
    id: number | string | undefined,
    env: Record<string, string | undefined>,
): Promise<JsonRpcResponse> {
    const requestId: number | string = id ?? Date.now()
    const body: string = JSON.stringify({jsonrpc: '2.0', method, params, id: requestId})

    const controller: AbortController = new AbortController()
    const timeout: NodeJS.Timeout = setTimeout((): void => controller.abort(), getTimeoutMs(env))

    let res: Response
    try {
        res = await fetch(`${url}/rpc`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body,
            signal: controller.signal,
        })
    } catch (cause) {
        throw new DaemonUnreachable(
            `Daemon at ${url} unreachable: ${cause instanceof Error ? cause.message : String(cause)} (token=${redactToken(token)})`,
        )
    } finally {
        clearTimeout(timeout)
    }

    if (res.status === 401) {
        throw new DaemonAuthRequired(
            `Daemon at ${url} rejected the bearer token. Token may be stale — re-read \`${url}\`'s project auth-token file.`,
        )
    }
    if (!res.ok) {
        const text: string = await res.text().catch((): string => '')
        throw new DaemonUnreachable(
            `Daemon at ${url} returned HTTP ${res.status}: ${text.slice(0, 200)}`,
        )
    }

    const parsed: unknown = await res.json().catch((cause: unknown): never => {
        throw new DaemonUnreachable(
            `Daemon at ${url} returned non-JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
    })
    if (!isRecord(parsed) || parsed.jsonrpc !== '2.0') {
        throw new DaemonUnreachable(`Daemon at ${url} returned non-JSON-RPC body`)
    }
    return parsed as unknown as JsonRpcResponse
}
