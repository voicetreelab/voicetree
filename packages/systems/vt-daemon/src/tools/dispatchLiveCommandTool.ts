/**
 * BF-379 · Phase 3 — JSON-RPC method `vt_dispatch_live_command`.
 *
 * Accepts a `SerializedCommand` from any RPC client (Electron Main or CLI),
 * hydrates it, and applies it to the daemon-owned session State store.
 * Returns `{ delta, revision }` where `revision` is the post-commit value
 * minted by the daemon — there is no second authority.
 */
import {
    hydrateCommand,
    type Command,
    type Delta,
    type SerializedCommand,
} from '@vt/graph-state'
import type { NodeIdAndFilePath, Position } from '@vt/graph-model/graph'

import { applyCommandToSessionState } from '../state/sessionStateStore'
import { getCurrentProject } from '../state/currentProject'

import { buildJsonResponse } from '@vt/vt-daemon/_shared/toolResponse.ts'
import type { McpToolResponse } from '@vt/vt-daemon/_shared/toolResponse.ts'

export interface DispatchLiveCommandParams {
    readonly command: SerializedCommand
}

export interface DispatchLiveCommandResult {
    readonly delta: SerializableDelta
    readonly revision: number
}

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
    readonly selectionAdded?: readonly string[]
    readonly selectionRemoved?: readonly string[]
    readonly rootsLoaded?: readonly string[]
    readonly rootsUnloaded?: readonly string[]
    readonly positionsMoved?: ReadonlyArray<readonly [NodeIdAndFilePath, Position]>
    readonly layoutChanged?: SerializableLayoutChanged
}

function serializeLayoutChanged(
    layoutChanged: NonNullable<Delta['layoutChanged']>,
): SerializableLayoutChanged {
    return {
        ...(layoutChanged.zoom !== undefined ? { zoom: layoutChanged.zoom } : {}),
        ...(layoutChanged.pan !== undefined ? { pan: layoutChanged.pan } : {}),
        ...(layoutChanged.positions !== undefined
            ? { positions: [...layoutChanged.positions.entries()] }
            : {}),
        ...(layoutChanged.fit !== undefined ? { fit: layoutChanged.fit } : {}),
    }
}

function toSerializableDelta(delta: Delta, cause: SerializedCommand): SerializableDelta {
    return {
        revision: delta.revision,
        cause,
        ...(delta.collapseAdded ? { collapseAdded: [...delta.collapseAdded] } : {}),
        ...(delta.collapseRemoved ? { collapseRemoved: [...delta.collapseRemoved] } : {}),
        ...(delta.selectionAdded ? { selectionAdded: [...delta.selectionAdded] } : {}),
        ...(delta.selectionRemoved ? { selectionRemoved: [...delta.selectionRemoved] } : {}),
        ...(delta.rootsLoaded ? { rootsLoaded: [...delta.rootsLoaded] } : {}),
        ...(delta.rootsUnloaded ? { rootsUnloaded: [...delta.rootsUnloaded] } : {}),
        ...(delta.positionsMoved
            ? { positionsMoved: [...delta.positionsMoved.entries()] }
            : {}),
        ...(delta.layoutChanged
            ? { layoutChanged: serializeLayoutChanged(delta.layoutChanged) }
            : {}),
    }
}

export async function dispatchLiveCommand(
    params: DispatchLiveCommandParams,
): Promise<DispatchLiveCommandResult> {
    const serializedCommand: SerializedCommand = params.command
    const command: Command = hydrateCommand(serializedCommand)
    const { delta }: { delta: Delta } = await applyCommandToSessionState(
        getCurrentProject(),
        command,
    )

    return {
        delta: toSerializableDelta(delta, serializedCommand),
        revision: delta.revision,
    }
}

export async function dispatchLiveCommandTool(
    params: DispatchLiveCommandParams,
): Promise<McpToolResponse> {
    try {
        const result: DispatchLiveCommandResult = await dispatchLiveCommand(params)
        return buildJsonResponse(result)
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({ error: message }, true)
    }
}
