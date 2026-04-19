/**
 * BF-162 · L1-LIVE2 — MCP tool `vt_dispatch_live_command`.
 *
 * Accepts a `SerializedCommand` from an MCP client, hydrates it, and applies
 * it to the main-side live State store. Returns `{ delta, revision }`.
 *
 * L3-BF-186: all 15 Command variants (Collapse/Expand/Select/Deselect,
 * AddNode/RemoveNode/AddEdge/RemoveEdge/Move, LoadRoot/UnloadRoot,
 * SetZoom/SetPan/SetPositions/RequestFit) now pass through
 * `applyCommandWithDelta`/`applyCommandAsyncWithDelta` — no more
 * `not-yet-wired` sentinel. LoadRoot is the only async case (disk I/O).
 */
import {
    hydrateCommand,
    type Command,
    type Delta,
    type SerializedCommand,
} from '@vt/graph-state'
import type { NodeIdAndFilePath, Position } from '@vt/graph-model/pure/graph'

import { applyLiveCommand } from '@/shell/edge/main/state/live-state-store'

import { buildJsonResponse } from './types'
import type { McpToolResponse } from './types'

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
    const delta: Delta = await applyLiveCommand(command)

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
