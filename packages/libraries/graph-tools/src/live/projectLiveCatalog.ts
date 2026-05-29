// Project-backed live-tool catalog for the headless HTTP daemon. Holds an
// in-process `State` (loaded from the project at startup, mutated by
// `vt_dispatch_live_command` thereafter) and exposes two handlers matching
// the live-tools wire that the renderer/CLI clients expect.
//
// Separated from `headlessServer.ts` so the transport layer stays
// transport-only — and so test fixtures can inject custom catalogs without
// dragging `@vt/graph-state` into the import graph.

import {resolve} from 'node:path'

import {
    applyCommandWithDelta,
    buildStateFromVault,
    emptyState,
    hydrateCommand,
    serializeState,
    type SerializedCommand,
} from '@vt/graph-state'
import type {Delta, State} from '@vt/graph-state/contract'

import {configureGraphToolsRootIO} from './rootIO'
import type {Catalog, CatalogHandler, ToolResult} from './headlessServerTypes'

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

export async function buildProjectLiveCatalog(projectPath?: string): Promise<Catalog> {
    configureGraphToolsRootIO()
    let state: State = emptyState()
    if (projectPath !== undefined && projectPath.length > 0) {
        const resolved: string = resolve(projectPath)
        state = await buildStateFromVault(resolved, resolved)
    }
    return new Map<string, CatalogHandler>([
        ['vt_get_live_state', async (): Promise<ToolResult> => {
            try {
                return {ok: true, payload: serializeState(state)}
            } catch (err) {
                return {ok: false, payload: {error: err instanceof Error ? err.message : String(err)}}
            }
        }],
        ['vt_dispatch_live_command', async (params: Record<string, unknown>): Promise<ToolResult> => {
            try {
                const serializedCommand: SerializedCommand = params.command as SerializedCommand
                const cmd = hydrateCommand(serializedCommand)
                const {state: nextState, delta} = applyCommandWithDelta(state, cmd)
                state = nextState
                return {
                    ok: true,
                    payload: {
                        delta: toSerializableDelta(delta, serializedCommand),
                        revision: delta.revision,
                    },
                }
            } catch (err) {
                return {ok: false, payload: {error: err instanceof Error ? err.message : String(err)}}
            }
        }],
    ])
}
