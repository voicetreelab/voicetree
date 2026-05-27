/**
 * BF-380 · Phase 3 — Main-as-client helper for the daemon's live-state RPC.
 *
 * This module is the single impurity boundary through which Electron Main
 * reaches the daemon's `vt_dispatch_live_command` and `vt_get_live_state`
 * routes. It exists so the daemon-owned `State` is reachable by Main with
 * the SAME wire transport the CLI uses — the C4 principle.
 *
 * Encapsulated here so Phase 1's higher-level `@vt/vt-daemon-client` (BF-373)
 * can swap in trivially later: callers depend only on the deep functions
 * `dispatchLiveCommandToDaemon` and `getLiveStateFromDaemon`, not on the
 * underlying RPC client.
 */
import {
    hydrateState,
    serializeCommand,
    type Command,
    type Delta,
    type SerializedCommand,
    type SerializedState,
    type State,
} from '@vt/graph-state'
import type { NodeIdAndFilePath, Position } from '@vt/graph-model/graph'
import { createRpcClientForVault, type DaemonRpcClient, type JsonRpcResponse } from '@vt/vt-rpc'

import { getActiveVault } from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'

interface SerializableLayoutChanged {
    readonly zoom?: number
    readonly pan?: Position
    readonly positions?: ReadonlyArray<readonly [NodeIdAndFilePath, Position]>
    readonly fit?: { readonly paddingPx: number } | null
}

interface SerializableDelta {
    readonly revision: number
    readonly cause: SerializedCommand
    readonly collapseAdded?: readonly string[]
    readonly collapseRemoved?: readonly string[]
    readonly selectionAdded?: readonly NodeIdAndFilePath[]
    readonly selectionRemoved?: readonly NodeIdAndFilePath[]
    readonly rootsLoaded?: readonly string[]
    readonly rootsUnloaded?: readonly string[]
    readonly positionsMoved?: ReadonlyArray<readonly [NodeIdAndFilePath, Position]>
    readonly layoutChanged?: SerializableLayoutChanged
}

interface DispatchLiveCommandRpcResult {
    readonly delta: SerializableDelta
    readonly revision: number
}

function hydrateLayoutChanged(
    layoutChanged: SerializableLayoutChanged,
): NonNullable<Delta['layoutChanged']> {
    return {
        ...(layoutChanged.zoom !== undefined ? { zoom: layoutChanged.zoom } : {}),
        ...(layoutChanged.pan !== undefined ? { pan: layoutChanged.pan } : {}),
        ...(layoutChanged.positions !== undefined
            ? { positions: new Map(layoutChanged.positions) }
            : {}),
        ...(layoutChanged.fit !== undefined ? { fit: layoutChanged.fit } : {}),
    }
}

function hydrateDelta(serializable: SerializableDelta): Delta {
    return {
        revision: serializable.revision,
        cause: serializable.cause as unknown as Command,
        ...(serializable.collapseAdded ? { collapseAdded: serializable.collapseAdded } : {}),
        ...(serializable.collapseRemoved ? { collapseRemoved: serializable.collapseRemoved } : {}),
        ...(serializable.selectionAdded ? { selectionAdded: serializable.selectionAdded } : {}),
        ...(serializable.selectionRemoved ? { selectionRemoved: serializable.selectionRemoved } : {}),
        ...(serializable.rootsLoaded ? { rootsLoaded: serializable.rootsLoaded } : {}),
        ...(serializable.rootsUnloaded ? { rootsUnloaded: serializable.rootsUnloaded } : {}),
        ...(serializable.positionsMoved
            ? { positionsMoved: new Map(serializable.positionsMoved) }
            : {}),
        ...(serializable.layoutChanged
            ? { layoutChanged: hydrateLayoutChanged(serializable.layoutChanged) }
            : {}),
    }
}

async function buildClient(): Promise<DaemonRpcClient> {
    const vaultPath: string | null = getActiveVault()
    if (!vaultPath) {
        throw new Error(
            'daemon-live-state-rpc: no vault is bound. Open a vault before dispatching live commands.',
        )
    }
    return await createRpcClientForVault(vaultPath, { env: process.env })
}

function unwrap<T>(response: JsonRpcResponse, method: string): T {
    if ('error' in response) {
        throw new Error(
            `${method} failed: ${response.error.message} (code=${response.error.code})`,
        )
    }
    return response.result as T
}

export async function dispatchLiveCommandToDaemon(command: Command): Promise<Delta> {
    const client: DaemonRpcClient = await buildClient()
    const serialized: SerializedCommand = serializeCommand(command)
    const response: JsonRpcResponse = await client.call('vt_dispatch_live_command', {
        command: serialized as unknown as Record<string, unknown>,
    })
    const result: DispatchLiveCommandRpcResult = unwrap<DispatchLiveCommandRpcResult>(
        response,
        'vt_dispatch_live_command',
    )
    return hydrateDelta(result.delta)
}

export async function getLiveStateFromDaemon(): Promise<State> {
    const client: DaemonRpcClient = await buildClient()
    const response: JsonRpcResponse = await client.call('vt_get_live_state', {})
    const serialized: SerializedState = unwrap<SerializedState>(response, 'vt_get_live_state')
    return hydrateState(serialized)
}
