// CLI-side daemon client. Public surface: `callDaemon(toolName, args)`.
//
// Discovery chain (design doc §2.7 / §3.2 — first match wins):
//   1. $VOICETREE_DAEMON_URL                          — token from
//      $VOICETREE_PROJECT_PATH/.voicetree/auth-token.
//   2. cwd up-walk for `.voicetree/rpc.port`          — token sibling.
//   3. $VOICETREE_PROJECT_PATH/.voicetree/rpc.port      — token sibling.
//   4. None resolve → DaemonUnreachable naming the missing env vars.
// Delegated to @vt/vt-rpc#discoverDaemonEndpoint; we recover the env-URL
// tier's token path from $VOICETREE_PROJECT_PATH locally because discovery
// returns `projectPath: null` for that tier. No `--daemon-url` CLI flag exists
// today; brief authorised deferring that 4th-tier surface.
//
// On HTTP 401: re-read the token from disk ONCE and retry. Second 401 throws
// `DaemonAuthRequired` naming the token-file path. $VOICETREE_DAEMON_TIMEOUT_MS
// (default 30_000) caps total RTT per attempt; local `DaemonTimeout` keeps the
// CLI able to distinguish a hung daemon from a hard network failure (brief
// authorised the local subclass to avoid a cross-substep extension of vt-rpc).

import {
    DaemonAuthRequired,
    DaemonUnreachable,
    ERROR_CODES,
    authTokenFilePath,
    discoverDaemonEndpoint,
    readAuthTokenFile,
    type ResolvedDaemonEndpoint,
} from '@vt/vt-rpc'

export {DaemonAuthRequired, DaemonUnreachable}

export class DaemonTimeout extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'DaemonTimeout'
    }
}

const DEFAULT_TIMEOUT_MS: number = 30_000

let requestSequence: number = 0

function nextRequestId(): number {
    requestSequence += 1
    return requestSequence
}

function getTimeoutMs(env: Record<string, string | undefined>): number {
    const raw: string | undefined = env.VOICETREE_DAEMON_TIMEOUT_MS
    if (raw === undefined) return DEFAULT_TIMEOUT_MS
    const parsed: number = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

interface ResolvedClient {
    readonly endpoint: ResolvedDaemonEndpoint
    readonly tokenProjectPath: string
    readonly tokenFilePath: string
    readonly token: string
}

function dropDaemonUrlOverride(env: Record<string, string | undefined>): Record<string, string | undefined> {
    const next: Record<string, string | undefined> = {...env}
    delete next.VOICETREE_DAEMON_URL
    return next
}

async function buildProjectDiscoveredClientAfterEnvUrlFailure(
    failedClient: ResolvedClient,
    env: Record<string, string | undefined>,
    cwd: string,
): Promise<ResolvedClient | null> {
    if (failedClient.endpoint.source !== 'env_url') return null

    let fallback: ResolvedClient
    try {
        fallback = await buildResolvedClient(dropDaemonUrlOverride(env), cwd)
    } catch {
        return null
    }

    return fallback.endpoint.url === failedClient.endpoint.url ? null : fallback
}

async function buildResolvedClient(
    env: Record<string, string | undefined>,
    cwd: string,
): Promise<ResolvedClient> {
    const endpoint: ResolvedDaemonEndpoint | null = await discoverDaemonEndpoint({env, cwd})
    if (!endpoint) {
        throw new DaemonUnreachable(
            'Cannot resolve VoiceTree daemon URL. Set $VOICETREE_DAEMON_URL, run inside a project containing `.voicetree/rpc.port`, or set $VOICETREE_PROJECT_PATH.',
        )
    }
    const envProjectPath: string | undefined = env.VOICETREE_PROJECT_PATH && env.VOICETREE_PROJECT_PATH.length > 0
        ? env.VOICETREE_PROJECT_PATH
        : undefined
    const tokenProjectPath: string | null = endpoint.projectPath ?? envProjectPath ?? null
    if (!tokenProjectPath) {
        throw new DaemonUnreachable(
            '$VOICETREE_DAEMON_URL is set but $VOICETREE_PROJECT_PATH is not. The auth-token file lives under the project — set $VOICETREE_PROJECT_PATH so the client can locate `.voicetree/auth-token`.',
        )
    }
    const tokenFilePath: string = authTokenFilePath(tokenProjectPath)
    const token: string = await loadToken(tokenProjectPath, tokenFilePath)
    return {endpoint, tokenProjectPath: tokenProjectPath, tokenFilePath, token}
}

async function loadToken(project: string, tokenFilePath: string): Promise<string> {
    const token: string | null = await readAuthTokenFile(project)
    if (token === null) {
        throw new DaemonAuthRequired(
            `Missing or empty auth-token at ${tokenFilePath}. Daemon may not be running, or the project path is wrong.`,
        )
    }
    return token
}

interface RawRpcResponse {
    readonly jsonrpc: '2.0'
    readonly id: number | string | null
    readonly result?: unknown
    readonly error?: {readonly code: number; readonly message: string; readonly data?: unknown}
}

type PostOutcome =
    | {readonly kind: 'ok'; readonly envelope: RawRpcResponse}
    | {readonly kind: 'auth_required'}

async function postRpc(
    url: string,
    token: string,
    method: string,
    args: Record<string, unknown>,
    timeoutMs: number,
): Promise<PostOutcome> {
    const controller: AbortController = new AbortController()
    let abortedByTimeout: boolean = false
    const timer: NodeJS.Timeout = setTimeout((): void => {
        abortedByTimeout = true
        controller.abort()
    }, timeoutMs)

    const body: string = JSON.stringify({jsonrpc: '2.0', method, params: args, id: nextRequestId()})
    let res: Response
    try {
        res = await fetch(`${url}/rpc`, {
            method: 'POST',
            headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
            body,
            signal: controller.signal,
        })
    } catch (cause) {
        if (abortedByTimeout) {
            throw new DaemonTimeout(`Daemon at ${url} did not respond within ${timeoutMs}ms (request aborted).`)
        }
        const message: string = cause instanceof Error ? cause.message : String(cause)
        throw new DaemonUnreachable(`Daemon at ${url} unreachable: ${message}`)
    } finally {
        clearTimeout(timer)
    }

    if (res.status === 401) return {kind: 'auth_required'}
    if (!res.ok) {
        const text: string = await res.text().catch((): string => '')
        throw new DaemonUnreachable(`Daemon at ${url} returned HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    let parsed: unknown
    try {
        parsed = await res.json()
    } catch (cause) {
        throw new DaemonUnreachable(
            `Daemon at ${url} returned non-JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
    }
    if (typeof parsed !== 'object' || parsed === null || (parsed as {jsonrpc?: unknown}).jsonrpc !== '2.0') {
        throw new DaemonUnreachable(`Daemon at ${url} returned non-JSON-RPC body.`)
    }
    return {kind: 'ok', envelope: parsed as RawRpcResponse}
}

// Pull the human-facing sentence out of a tool-handler failure payload.
//
// The daemon's dispatcher (rpcDispatch.ts `dispatchRpcRequest`) sets
// `error.data` to the *parsed* tool error object — for the agent/graph tool
// family that is `{success: false, error: '<plain sentence>'}` (some internal
// `Result` paths spell it `{ok: false, error}`). Re-stringifying that object
// (the previous behaviour) surfaced a raw nested-JSON blob at the CLI edge.
// We read the sentence directly so every caller-terminal failure prints as a
// plain sentence; we fall back to the envelope `message` when `data` carries
// no recognisable sentence field.
function extractToolFailureSentence(data: unknown, fallbackMessage: string): string {
    if (typeof data === 'string' && data.length > 0) return data
    if (typeof data === 'object' && data !== null) {
        const record = data as Record<string, unknown>
        const error: unknown = record.error
        if (typeof error === 'string' && error.length > 0) return error
        const message: unknown = record.message
        if (typeof message === 'string' && message.length > 0) return message
    }
    return fallbackMessage
}

// Caller-terminal-gated tool failures ("Unknown caller terminal: …") happen
// when a headless/CLI peer with no registered terminal tries a write tool
// that requires a caller terminal (spawn, send, wait, create_graph live mode).
// The filesystem-mode authoring path (`vt graph create <file.md>`) parses the
// markdown locally and is the headless-safe write path, so we hint it here.
const CALLER_GATED_SENTINEL: string = 'Unknown caller terminal'
const HEADLESS_WRITE_HINT: string =
    'For headless/CLI writes without a caller terminal, author nodes as markdown and use the ' +
    'filesystem-mode authoring path: `vt graph create <file.md>`.'

function appendHeadlessWriteHintIfCallerGated(sentence: string): string {
    return sentence.includes(CALLER_GATED_SENTINEL) ? `${sentence} ${HEADLESS_WRITE_HINT}` : sentence
}

function throwForRpcError(
    error: {readonly code: number; readonly message: string; readonly data?: unknown},
    tokenFilePath: string,
): never {
    switch (error.code) {
        case ERROR_CODES.tool_handler_failed: {
            const sentence: string = extractToolFailureSentence(error.data, error.message)
            throw new Error(appendHeadlessWriteHintIfCallerGated(sentence))
        }
        case ERROR_CODES.validation_failed:
            throw new Error(JSON.stringify({kind: 'validation_failed', data: error.data}))
        case ERROR_CODES.auth_required:
            throw new DaemonAuthRequired(
                `Daemon reported auth_required. Re-check ${tokenFilePath} and confirm the daemon is the one that wrote it.`,
            )
        case ERROR_CODES.daemon_unreachable:
            throw new DaemonUnreachable(error.message)
        default:
            throw new Error(error.message)
    }
}

export async function callDaemon(
    toolName: string,
    args: Record<string, unknown>,
): Promise<unknown> {
    const env: Record<string, string | undefined> = process.env
    const cwd: string = process.cwd()
    const timeoutMs: number = getTimeoutMs(env)
    let client: ResolvedClient = await buildResolvedClient(env, cwd)

    let outcome: PostOutcome
    try {
        outcome = await postRpc(client.endpoint.url, client.token, toolName, args, timeoutMs)
    } catch (error) {
        if (!(error instanceof DaemonUnreachable)) throw error
        const fallbackClient: ResolvedClient | null =
            await buildProjectDiscoveredClientAfterEnvUrlFailure(client, env, cwd)
        if (fallbackClient === null) throw error
        client = fallbackClient
        outcome = await postRpc(client.endpoint.url, client.token, toolName, args, timeoutMs)
    }

    if (outcome.kind === 'auth_required') {
        const freshToken: string = await loadToken(client.tokenProjectPath, client.tokenFilePath)
        outcome = await postRpc(client.endpoint.url, freshToken, toolName, args, timeoutMs)
        if (outcome.kind === 'auth_required') {
            throw new DaemonAuthRequired(
                `Daemon at ${client.endpoint.url} rejected the bearer token after one retry. Re-check ${client.tokenFilePath} — the daemon may have been restarted with a new token.`,
            )
        }
    }

    if (outcome.envelope.error) throwForRpcError(outcome.envelope.error, client.tokenFilePath)
    return outcome.envelope.result
}
