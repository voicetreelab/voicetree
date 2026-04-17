/**
 * BF-162 · L1-LIVE2 — MCP tool `vt_dispatch_live_command`.
 *
 * Accepts a `SerializedCommand` from an MCP client, hydrates it, and applies
 * it to the main-side live State store. Returns `{ delta, revision }`.
 *
 * Scope:
 *   - Collapse, Expand, Select, Deselect are fully wired (4 most-used).
 *   - The remaining 7 commands (AddNode, RemoveNode, AddEdge, RemoveEdge,
 *     Move, LoadRoot, UnloadRoot) return `{ error: 'not-yet-wired' }`
 *     with the current revision untouched. They will be wired once the
 *     respective G-task `applyCommand` cases land.
 */
import {
    hydrateCommand,
    type Command,
    type Delta,
    type SerializedCommand,
} from '@vt/graph-state'

import { applyLiveCommand, getCurrentLiveState } from '@/shell/edge/main/state/live-state-store'
import { uiAPI } from '@/shell/edge/main/ui-api-proxy'

import { buildJsonResponse } from './types'
import type { McpToolResponse } from './types'

const WIRED_COMMAND_TYPES: ReadonlySet<Command['type']> = new Set<Command['type']>([
    'Collapse', 'Expand', 'Select', 'Deselect',
])

export interface DispatchLiveCommandParams {
    readonly command: SerializedCommand
}

export interface DispatchLiveCommandResult {
    readonly delta: SerializableDelta
    readonly revision: number
    readonly error?: 'not-yet-wired'
}

interface SerializableDelta {
    readonly revision: number
    readonly cause: SerializedCommand
    readonly collapseAdded?: readonly string[]
    readonly collapseRemoved?: readonly string[]
    readonly selectionAdded?: readonly string[]
    readonly selectionRemoved?: readonly string[]
}

function toSerializableDelta(delta: Delta, cause: SerializedCommand): SerializableDelta {
    return {
        revision: delta.revision,
        cause,
        ...(delta.collapseAdded ? { collapseAdded: [...delta.collapseAdded] } : {}),
        ...(delta.collapseRemoved ? { collapseRemoved: [...delta.collapseRemoved] } : {}),
        ...(delta.selectionAdded ? { selectionAdded: [...delta.selectionAdded] } : {}),
        ...(delta.selectionRemoved ? { selectionRemoved: [...delta.selectionRemoved] } : {}),
    }
}

export function dispatchLiveCommand(
    params: DispatchLiveCommandParams,
): DispatchLiveCommandResult {
    const serializedCommand: SerializedCommand = params.command
    const command: Command = hydrateCommand(serializedCommand)

    if (!WIRED_COMMAND_TYPES.has(command.type)) {
        const currentRevision: number = getCurrentLiveState().meta.revision
        return {
            delta: { revision: currentRevision, cause: serializedCommand },
            revision: currentRevision,
            error: 'not-yet-wired',
        }
    }

    const delta: Delta = applyLiveCommand(command)

    // Best-effort push to renderer so cytoscape reflects the command.
    // Fire-and-forget; we do not block the MCP reply on renderer ack (L2 cleanup
    // collapses the duplicate renderer stores anyway — see BF-162 spec Notes).
    try {
        uiAPI.applyLiveCommand(serializedCommand)
    } catch (error) {
        console.warn('[dispatchLiveCommand] renderer sync failed (non-fatal):', error)
    }

    return {
        delta: toSerializableDelta(delta, serializedCommand),
        revision: delta.revision,
    }
}

export async function dispatchLiveCommandTool(
    params: DispatchLiveCommandParams,
): Promise<McpToolResponse> {
    try {
        const result: DispatchLiveCommandResult = dispatchLiveCommand(params)
        return buildJsonResponse(result)
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({ error: message }, true)
    }
}
