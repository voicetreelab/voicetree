// JSON-RPC over HTTP client for the daemon's live tools
// (`vt_get_live_state`, `vt_dispatch_live_command`). The public contract is
// unchanged from Step 7c — callers still receive a `LiveTransport` with
// `getLiveState()` and `dispatchLiveCommand(cmd)`. Only the wire moved (UDS
// NDJSON → HTTP JSON-RPC + bearer auth, design doc §2.1 + §4.2).
//
// Endpoint resolution:
//   - With an explicit `vaultPath`: `createRpcClientForVault` reads rpc.port +
//     auth-token directly from that vault. `$VOICETREE_DAEMON_URL` still
//     overrides the URL (per-process override) but the token comes from the
//     named vault.
//   - Without `vaultPath`: full design doc §2.7 chain via `createRpcClient`
//     (env URL → cwd up-walk → `$VOICETREE_VAULT_PATH` → throw).
//
// Error mapping harmonized with the CLI client (`webapp/.../daemon-client.ts`):
// `-32003 tool_handler_failed` and `-32602 validation_failed` both surface as
// `Error(JSON.stringify(error.data))` — the data envelope already includes a
// `kind` discriminator for callers that want to branch on it. Transport
// failures and 401 map to `DaemonUnreachable` / `DaemonAuthRequired`.

import {
    createRpcClient,
    createRpcClientForVault,
    DaemonAuthRequired,
    DaemonUnreachable,
    ERROR_CODES,
    type DaemonRpcClient,
    type JsonRpcResponse,
} from '@vt/vt-rpc'

import {hydrateState, serializeCommand, type SerializedState} from '@vt/graph-state'
import type {Command, Delta, State} from '@vt/graph-state/contract'

export {DaemonAuthRequired, DaemonUnreachable}

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

let requestSequence: number = 0
function nextRequestId(): number {
    requestSequence += 1
    return requestSequence
}

// Defer the (async) endpoint resolution until the first call so the
// constructor stays synchronous (existing positional-arg call sites in
// `live.ts`, `commands/capture/*`, etc. expect a `LiveTransport`, not a
// Promise of one). First failure caches its error so subsequent calls return
// the same DaemonUnreachable without re-probing — graph-tools' callers are
// scripted one-shots.
//
// `env` is captured at construction time. Two transports created back-to-back
// against different vaults must not share a destination just because the
// caller mutated `process.env` between the construction and the first
// `.call()`. The `vtHeadlessServe` "two concurrent servers" test encodes this
// contract.
function buildClientFactory(vaultPath: string | undefined): () => Promise<DaemonRpcClient> {
    const env: Record<string, string | undefined> = {...process.env}
    const cwd: string = process.cwd()
    let pending: Promise<DaemonRpcClient> | null = null
    return (): Promise<DaemonRpcClient> => {
        if (pending === null) pending = resolveClient(vaultPath, env, cwd)
        return pending
    }
}

async function resolveClient(
    vaultPath: string | undefined,
    env: Record<string, string | undefined>,
    cwd: string,
): Promise<DaemonRpcClient> {
    if (vaultPath !== undefined && vaultPath.length > 0) {
        // Explicit vault: bypass cwd up-walk; vt-rpc reads rpc.port + token
        // straight from this vault. `$VOICETREE_DAEMON_URL` still wins inside
        // `createRpcClientForVault` (per-process override), and the token
        // always comes from the named vault — no env-var juggling required.
        return createRpcClientForVault(vaultPath, {env})
    }
    return createRpcClient({env, cwd})
}

function mapRpcError(response: JsonRpcResponse): never {
    if (!('error' in response)) {
        throw new Error('mapRpcError called on success response')
    }
    const {code, message, data} = response.error
    if (code === ERROR_CODES.auth_required) {
        throw new DaemonAuthRequired(message)
    }
    if (code === ERROR_CODES.daemon_unreachable) {
        throw new DaemonUnreachable(message)
    }
    if (code === ERROR_CODES.tool_handler_failed || code === ERROR_CODES.validation_failed) {
        // Both envelopes carry a `data` payload that downstream callers want
        // structured access to — stringify so JSON.parse(err.message) round-
        // trips it. Mirrors the CLI shim (`daemon-client.ts`).
        throw new Error(JSON.stringify(data))
    }
    throw new Error(message)
}

async function callTool<T>(
    client: DaemonRpcClient,
    method: string,
    params: Record<string, unknown>,
): Promise<T> {
    const response: JsonRpcResponse = await client.call(method, params, nextRequestId())
    if ('error' in response) mapRpcError(response)
    return (response as {result: unknown}).result as T
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

export function createLiveTransport(vaultPath?: string): LiveTransport {
    const getClient: () => Promise<DaemonRpcClient> = buildClientFactory(vaultPath)
    return {
        async getLiveState(): Promise<State> {
            const client: DaemonRpcClient = await getClient()
            const serialized: SerializedState = await callTool<SerializedState>(
                client,
                'vt_get_live_state',
                {},
            )
            return hydrateState(serialized)
        },
        async dispatchLiveCommand(cmd: Command): Promise<Delta> {
            const client: DaemonRpcClient = await getClient()
            const serialized = serializeCommand(cmd)
            const result: DispatchResult = await callTool<DispatchResult>(
                client,
                'vt_dispatch_live_command',
                {command: serialized},
            )
            return hydrateDelta(result.delta, cmd)
        },
    }
}
