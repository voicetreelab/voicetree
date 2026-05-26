/**
 * BF-379 · Phase 3 — daemon-side session state store.
 *
 * Owns the per-vault `@vt/graph-state` `State` (graph, roots, layout, meta)
 * that used to live in Electron Main's `live-state-store.ts`. Every accepted
 * `applyCommandToSessionState` call bumps the authoritative revision counter
 * exactly once, atomically with the state mutation.
 *
 * Functional design:
 *   - Public API is narrow (read, mutate, test-reset) and deep (assembly +
 *     application + persistence composition is hidden).
 *   - `buildInitialState` and `applyCommandWithDelta` are pure.
 *   - The impure shell (`readGraphFromGraphd`, `readVaultStateFromGraphd`,
 *     `persistPositionsToGraphd`) is the only side-effecting boundary; it
 *     speaks JSON-RPC to vt-graphd over HTTP, so every client of this module
 *     sees the same state regardless of how they reach the daemon.
 *
 * Bootstrap mirrors today's main-side `bootstrapRootsFromProjectConfig`:
 * `roots.loaded` seeds from vt-graphd's `writeFolder` on first read.
 */

import {
    applyCommandWithDelta,
    type Command,
    type Delta,
    type State,
} from '@vt/graph-state'
import {
    applyGraphDeltaToGraph,
    createEmptyGraph,
    mapNewGraphToDelta,
    type Graph,
    type GraphNode,
    type NodeIdAndFilePath,
    type Position,
} from '@vt/graph-model'
import { GraphDbClient } from '@vt/graph-db-client'
import type { VaultState } from '@vt/graph-db-protocol'

export type AbsolutePath = string
export type PositionMap = Record<string, Position>

const stateByVault: Map<AbsolutePath, State> = new Map()
const clientByVault: Map<AbsolutePath, GraphDbClient> = new Map()

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getCurrentSessionState(vault: AbsolutePath): Promise<State> {
    return await loadOrBootstrap(vault)
}

export async function applyCommandToSessionState(
    vault: AbsolutePath,
    command: Command,
): Promise<{ readonly state: State; readonly delta: Delta }> {
    const before: State = await loadOrBootstrap(vault)
    const result: { state: State; delta: Delta } = applyCommandWithDelta(before, command)
    stateByVault.set(vault, result.state)
    await persistMovedPositionsIfAny(vault, result.delta)
    return { state: result.state, delta: result.delta }
}

async function persistMovedPositionsIfAny(
    vault: AbsolutePath,
    delta: Delta,
): Promise<void> {
    if (!delta.positionsMoved || delta.positionsMoved.size === 0) return
    const positions: PositionMap = {}
    for (const [nodeId, position] of delta.positionsMoved.entries()) {
        positions[nodeId] = position
    }
    await persistPositionsToGraphd(vault, positions)
}

export function __resetSessionStateForTests(vault?: AbsolutePath): void {
    if (vault === undefined) {
        stateByVault.clear()
        clientByVault.clear()
        return
    }
    stateByVault.delete(vault)
    clientByVault.delete(vault)
}

// ─── Pure assembly ───────────────────────────────────────────────────────────

function buildInitialState(graph: Graph, vaultState: VaultState): State {
    const loaded: ReadonlySet<string> = vaultState.writeFolder
        ? new Set([vaultState.writeFolder])
        : new Set()
    return {
        graph,
        roots: {
            loaded,
            folderTree: [],
        },
        collapseSet: new Set(),
        selection: new Set(),
        layout: {
            positions: new Map(),
        },
        meta: {
            schemaVersion: 1,
            revision: 0,
        },
    }
}

// ─── Impure shell (vt-graphd boundary) ───────────────────────────────────────

async function loadOrBootstrap(vault: AbsolutePath): Promise<State> {
    // Re-read writeFolder from vt-graphd on every call: setWriteFolder() can
    // change it after first bootstrap, and there's no longer a
    // syncWatchedProjectRoot hook to invalidate downstream caches. Costs one
    // extra RPC per read but keeps roots.loaded honest without coupling to
    // vault-state events.
    const vaultState: VaultState = await readVaultStateFromGraphd(vault)
    const cached: State | undefined = stateByVault.get(vault)
    if (cached) {
        const refreshed: State = refreshLoadedRoots(cached, vaultState)
        if (refreshed !== cached) stateByVault.set(vault, refreshed)
        return refreshed
    }
    const graph: Graph = await readGraphFromGraphd(vault)
    const initial: State = buildInitialState(graph, vaultState)
    stateByVault.set(vault, initial)
    return initial
}

function refreshLoadedRoots(state: State, vaultState: VaultState): State {
    const loaded: ReadonlySet<string> = vaultState.writeFolder
        ? new Set([vaultState.writeFolder])
        : new Set()
    if (sameLoadedRoots(state.roots.loaded, loaded)) return state
    return {
        ...state,
        roots: {
            ...state.roots,
            loaded,
        },
    }
}

function sameLoadedRoots(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) return false
    for (const entry of a) if (!b.has(entry)) return false
    return true
}

async function getOrCreateClient(vault: AbsolutePath): Promise<GraphDbClient> {
    const cached: GraphDbClient | undefined = clientByVault.get(vault)
    if (cached) return cached
    const client: GraphDbClient = await GraphDbClient.connect({ vault })
    clientByVault.set(vault, client)
    return client
}

async function readGraphFromGraphd(vault: AbsolutePath): Promise<Graph> {
    const client: GraphDbClient = await getOrCreateClient(vault)
    const raw: { readonly nodes: Record<string, unknown> } = await client.getGraph()
    return normalizeGraph(raw.nodes)
}

async function readVaultStateFromGraphd(vault: AbsolutePath): Promise<VaultState> {
    const client: GraphDbClient = await getOrCreateClient(vault)
    return await client.getVault()
}

export async function persistPositionsToGraphd(
    vault: AbsolutePath,
    positions: PositionMap,
): Promise<void> {
    if (Object.keys(positions).length === 0) return
    const client: GraphDbClient = await getOrCreateClient(vault)
    await client.writePositions(positions)
}

function normalizeGraph(rawNodes: Record<string, unknown>): Graph {
    const empty: Graph = createEmptyGraph()
    return applyGraphDeltaToGraph(
        empty,
        mapNewGraphToDelta({
            ...empty,
            nodes: rawNodes as Record<NodeIdAndFilePath, GraphNode>,
        }),
    )
}
