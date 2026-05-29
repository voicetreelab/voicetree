// In-browser daemon stub for the folder-node playground.
//
// Stands in for what the real graph-db-server does: hold mutable Session state
// (collapseSet) plus an immutable Graph + FolderTreeNode + VaultState, and on
// every folder-state command re-run the REAL pure `project()` function from
// @vt/graph-state to produce a fresh ProjectedGraph.
//
// This is the seam that replaces IPC → daemon process → SSE: same boundary
// shape (folderId+state → ProjectedGraph), but invoked synchronously in-browser.

// Subpath import avoids the @vt/graph-state barrel, which transitively pulls
// in the node-only `fixtures` module (uses `fs` + `path`).
import { project } from '@vt/graph-state/project'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import type { Graph } from '@vt/graph-model'
import type { FolderTreeNode } from '@vt/graph-model/folders'
import type { VaultState } from '@vt/graph-db-protocol'

import type { Session } from './sessionTypes'

export interface DaemonState {
    readonly vault: VaultState
    readonly graph: Graph
    readonly folderTree: FolderTreeNode
    readonly session: Session
}

export type FolderState = 'expanded' | 'collapsed' | 'hidden'

export interface InBrowserDaemon {
    /** Return the current projection. Pure-ish: derives from current Session. */
    getProjection(): ProjectedGraph
    /**
     * Apply a folder-state command (the real IPC entry point's contract) and
     * return the freshly-projected graph. Mirrors graph-db-server's
     * setFolderStateThroughDaemon return shape.
     */
    setFolderState(folderId: string, state: FolderState): ProjectedGraph
    /**
     * Subscribe to projection updates. Returns an unsubscribe function.
     * The callback fires after every setFolderState call.
     */
    onProjectionUpdate(callback: (graph: ProjectedGraph) => void): () => void
    /** Cytoscape position seeds keyed by file-node absolute path. */
    readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>
    /** The underlying immutable Graph — exposed so the editor stack's
     *  getGraph()/getNode() IPC stubs can answer from the same source of truth. */
    readonly graph: Graph
}

export interface CreateInBrowserDaemonArgs {
    readonly vault: VaultState
    readonly graph: Graph
    readonly folderTree: FolderTreeNode
    readonly initialCollapsedFolderIds: ReadonlySet<string>
    readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>
}

function makeSession(initialCollapsed: ReadonlySet<string>): Session {
    return {
        id: 'mockup-session',
        collapseSet: new Set<string>(initialCollapsed),
        selection: new Set<string>(),
        expandOverrides: new Set<string>(),
        layout: { positions: {}, pan: { x: 0, y: 0 }, zoom: 1 },
        lastAccessedAt: Date.now(),
    }
}

function projectFromState(daemon: DaemonState): ProjectedGraph {
    const positionsMap: Map<string, { x: number; y: number }> = new Map()
    for (const [nodeId, node] of Object.entries(daemon.graph.nodes)) {
        const posOpt: typeof node.nodeUIMetadata.position = node.nodeUIMetadata.position
        if (posOpt._tag === 'Some') {
            positionsMap.set(nodeId, posOpt.value)
        }
    }
    return project({
        graph: daemon.graph,
        roots: {
            loaded: new Set<string>([daemon.vault.writeFolderPath, ...daemon.vault.readPaths].filter((p) => p.length > 0)),
            folderTree: [daemon.folderTree],
        },
        collapseSet: new Set(daemon.session.collapseSet),
        selection: new Set(daemon.session.selection),
        layout: {
            positions: positionsMap,
            zoom: daemon.session.layout.zoom,
            pan: daemon.session.layout.pan,
        },
        meta: {
            schemaVersion: 1,
            revision: 0,
            mutatedAt: new Date(daemon.session.lastAccessedAt).toISOString(),
        },
    })
}

export function createInBrowserDaemon(args: CreateInBrowserDaemonArgs): InBrowserDaemon {
    // Inject seed positions onto the graph nodes via fixture-time position map
    // — project() collects layout via collectLayoutPositions on the Graph
    // itself, but the playground synthesises Graph nodes without positions, so
    // we layer a parallel positions map and feed it to project() each time.
    const state: DaemonState = {
        vault: args.vault,
        graph: args.graph,
        folderTree: args.folderTree,
        session: makeSession(args.initialCollapsedFolderIds),
    }
    const subscribers: Set<(graph: ProjectedGraph) => void> = new Set()

    function getProjection(): ProjectedGraph {
        const projected: ProjectedGraph = projectFromState(state)
        return overlayPositions(projected, args.positions)
    }

    function setFolderState(folderId: string, nextState: FolderState): ProjectedGraph {
        if (nextState === 'collapsed') state.session.collapseSet.add(folderId)
        else state.session.collapseSet.delete(folderId)
        state.session.lastAccessedAt = Date.now()
        const projected: ProjectedGraph = getProjection()
        for (const cb of subscribers) cb(projected)
        return projected
    }

    function onProjectionUpdate(callback: (graph: ProjectedGraph) => void): () => void {
        subscribers.add(callback)
        return (): void => { subscribers.delete(callback) }
    }

    return { getProjection, setFolderState, onProjectionUpdate, positions: args.positions, graph: state.graph }
}

// project() picks up positions from `state.layout.positions` (collected from
// the Graph) — but our synthetic graph has none. Rather than mutate the Graph,
// overlay the fixture's positions onto the projected file nodes here. Keeps
// the fixture authorship decoupled from the GraphNode shape.
function overlayPositions(
    projected: ProjectedGraph,
    positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): ProjectedGraph {
    if (positions.size === 0) return projected
    const nextNodes = projected.nodes.map((n) => {
        if (n.kind !== 'file') return n
        const pos = positions.get(n.id)
        if (!pos) return n
        if (n.position !== undefined) return n
        return { ...n, position: pos }
    })
    return { ...projected, nodes: nextNodes }
}
