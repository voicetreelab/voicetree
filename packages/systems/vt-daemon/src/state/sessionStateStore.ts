/**
 * BF-379 · Phase 3 — daemon-side session state store.
 *
 * Owns the per-project `@vt/graph-state` `State` (graph, roots, layout, meta)
 * that used to live in Electron Main's `live-state-store.ts`. Every accepted
 * `applyCommandToSessionState` call bumps the authoritative revision counter
 * exactly once, atomically with the state mutation.
 *
 * Functional design:
 *   - Public API is narrow (read, mutate, test-reset) and deep (assembly +
 *     application + persistence composition is hidden).
 *   - `buildInitialState` and `applyCommandWithDelta` are pure.
 *   - The impure shell (`readGraphFromGraphd`, `readProjectStateFromGraphd`,
 *     `persistPositionsToGraphd`) is the only side-effecting boundary; it
 *     speaks JSON-RPC to vt-graphd over HTTP, so every client of this module
 *     sees the same state regardless of how they reach the daemon.
 *
 * Bootstrap mirrors today's main-side `bootstrapRootsFromProjectConfig`:
 * `roots.loaded` seeds from vt-graphd's `writeFolderPath` on first read.
 */

import {
    applyCommandWithDelta,
    type Command,
    type Delta,
    type State,
} from '@vt/graph-state'
import { projectGraphDerivedFolderTree } from '@vt/graph-state/projectGraphDerivedFolderTree'
import {
    rehydrateSerializedGraph,
    type FolderTreeNode,
    type Graph,
    type Position,
} from '@vt/graph-model'
import { GraphDbClient } from '@vt/graph-db-client'
import type { ProjectState } from '@vt/graph-db-protocol'

export type AbsolutePath = string
export type PositionMap = Record<string, Position>

const stateByProject: Map<AbsolutePath, State> = new Map()
const clientByProject: Map<AbsolutePath, GraphDbClient> = new Map()

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getCurrentSessionState(project: AbsolutePath): Promise<State> {
    return await loadOrBootstrap(project)
}

export async function applyCommandToSessionState(
    project: AbsolutePath,
    command: Command,
): Promise<{ readonly state: State; readonly delta: Delta }> {
    const before: State = await loadOrBootstrap(project)
    const result: { state: State; delta: Delta } = applyCommandWithDelta(before, command)
    stateByProject.set(project, result.state)
    await persistMovedPositionsIfAny(project, result.delta)
    return { state: result.state, delta: result.delta }
}

async function persistMovedPositionsIfAny(
    project: AbsolutePath,
    delta: Delta,
): Promise<void> {
    if (!delta.positionsMoved || delta.positionsMoved.size === 0) return
    const positions: PositionMap = {}
    for (const [nodeId, position] of delta.positionsMoved.entries()) {
        positions[nodeId] = position
    }
    await persistPositionsToGraphd(project, positions)
}

export function __resetSessionStateForTests(project?: AbsolutePath): void {
    if (project === undefined) {
        stateByProject.clear()
        clientByProject.clear()
        return
    }
    stateByProject.delete(project)
    clientByProject.delete(project)
}

// ─── Pure assembly ───────────────────────────────────────────────────────────

function buildInitialState(graph: Graph, projectState: ProjectState): State {
    const loaded: ReadonlySet<string> = projectState.writeFolderPath
        ? new Set([projectState.writeFolderPath])
        : new Set()
    const folderTree: FolderTreeNode | null = projectGraphDerivedFolderTree({
        graph,
        projectRoot: projectState.projectRoot || null,
        readPaths: projectState.readPaths,
        projectPaths: [projectState.writeFolderPath, ...projectState.readPaths].filter((path) => path.length > 0),
        writeFolderPath: projectState.writeFolderPath || null,
    })
    return {
        graph,
        roots: {
            loaded,
            folderTree: folderTree ? [folderTree] : [],
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

async function loadOrBootstrap(project: AbsolutePath): Promise<State> {
    // Re-read writeFolderPath from vt-graphd on every call: setWriteFolderPath() can
    // change it after first bootstrap, and there's no longer a
    // syncWatchedProjectRoot hook to invalidate downstream caches. Costs one
    // extra RPC per read but keeps roots.loaded honest without coupling to
    // project-state events.
    const projectState: ProjectState = await readProjectStateFromGraphd(project)
    const cached: State | undefined = stateByProject.get(project)
    if (cached) {
        const refreshed: State = refreshLoadedRoots(cached, projectState)
        if (refreshed !== cached) stateByProject.set(project, refreshed)
        return refreshed
    }
    const graph: Graph = await readGraphFromGraphd(project)
    const initial: State = buildInitialState(graph, projectState)
    stateByProject.set(project, initial)
    return initial
}

function refreshLoadedRoots(state: State, projectState: ProjectState): State {
    const loaded: ReadonlySet<string> = projectState.writeFolderPath
        ? new Set([projectState.writeFolderPath])
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

async function getOrCreateClient(project: AbsolutePath): Promise<GraphDbClient> {
    const cached: GraphDbClient | undefined = clientByProject.get(project)
    if (cached) return cached
    const client: GraphDbClient = await GraphDbClient.connect({ project })
    clientByProject.set(project, client)
    return client
}

async function readGraphFromGraphd(project: AbsolutePath): Promise<Graph> {
    const client: GraphDbClient = await getOrCreateClient(project)
    const raw: { readonly nodes: Record<string, unknown> } = await client.getGraph()
    return rehydrateSerializedGraph(raw)
}

async function readProjectStateFromGraphd(project: AbsolutePath): Promise<ProjectState> {
    const client: GraphDbClient = await getOrCreateClient(project)
    return await client.getProject()
}

export async function persistPositionsToGraphd(
    project: AbsolutePath,
    positions: PositionMap,
): Promise<void> {
    if (Object.keys(positions).length === 0) return
    const client: GraphDbClient = await getOrCreateClient(project)
    await client.writeNodeLayout(positions)
}
