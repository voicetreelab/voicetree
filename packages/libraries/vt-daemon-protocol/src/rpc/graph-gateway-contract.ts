/**
 * The `graph.*` RPC contract — the VTD GATEWAY surface for graph reads,
 * mutations and views.
 *
 * Under the gateway model (RE-PLAN B) the browser talks ONLY to VTD; vt-graphd
 * is loopback-internal behind it. VTD fronts graphd using its existing
 * `@vt/graph-db-client` and registers these methods on its internal
 * `RPC_ROUTES` bucket (NOT the agent `TOOL_CATALOG`). This module is the
 * ONE place the daemon (server side, `buildGraphGatewayRoutes`) and the webapp
 * (Agent C, the browser adapter) both import — method-name constants and
 * Request/Response TYPES live here so there is a single source of truth for the
 * wire contract.
 *
 * Session is IMPLICIT. VTD owns exactly one graphd session for the project
 * (created on `graph.openProject`) and injects `X-Session-Id` when delegating
 * session-scoped calls. The browser never passes or sees a graphd sessionId on
 * mutations — it receives the id once from `graph.openProject` and uses it as
 * the opaque key for its other VTD subscriptions (terminal-registry SSE), so a
 * single session is threaded end-to-end.
 *
 * Type reuse: domain shapes are imported, never re-declared — `Graph`,
 * `GraphNode`, `GraphDelta`, `Position` from `@vt/graph-model/graph`,
 * `ProjectedGraph` from `@vt/graph-state/contract`, and `ProjectState` /
 * `ViewRecord` from `@vt/graph-db-protocol`. Wire dialect is JSON-RPC 2.0 over
 * `POST /rpc`, identical to the BF-376 terminal routes; fp-ts `Option<X>`
 * inside `Graph`/`GraphDelta` round-trips as `{_tag}` exactly as it does for
 * the terminal contract.
 */

import type {
    Graph,
    GraphNode,
    GraphDelta,
    Position,
} from '@vt/graph-model/graph'
import type {AvailableFolderItem, RawDirectoryEntry, FolderTreeNode} from '@vt/graph-model/folders'
import type {ProjectedGraph} from '@vt/graph-state/contract'
import type {ProjectState, ViewRecord} from '@vt/graph-db-protocol'
import type {VoidResponse} from './rpc-contracts.ts'

// ---------------------------------------------------------------------------
// Method-name constants — single source of truth for the dotted wire names.
// ---------------------------------------------------------------------------

/**
 * Canonical dotted method names for every gateway RPC. The server binds its
 * routes against these and Agent C posts against them, so a rename here is a
 * single edit that both sides pick up. Mirrors `metrics.*` dotted naming.
 */
export const GRAPH_GATEWAY_METHODS = {
    // Boot
    openProject: 'graph.openProject',
    // Reads
    getProject: 'graph.getProject',
    getGraph: 'graph.getGraph',
    getNode: 'graph.getNode',
    getProjectedGraph: 'graph.getProjectedGraph',
    // Mutations
    applyDelta: 'graph.applyDelta',
    writeMarkdownFile: 'graph.writeMarkdownFile',
    writePositions: 'graph.writePositions',
    findFileByName: 'graph.findFileByName',
    getPreviewContainedNodeIds: 'graph.getPreviewContainedNodeIds',
    createContextNode: 'graph.createContextNode',
    undo: 'graph.undo',
    redo: 'graph.redo',
    setWriteFolderPath: 'graph.setWriteFolderPath',
    // Views
    listViews: 'graph.listViews',
    activateView: 'graph.activateView',
    cloneView: 'graph.cloneView',
    deleteView: 'graph.deleteView',
    // Folders (browser-mode daemon-served folder browser / project FS)
    getFolderTreeSync: 'graph.getFolderTreeSync',
    getAvailableFolders: 'graph.getAvailableFolders',
    getDirectoryTree: 'graph.getDirectoryTree',
    createSubfolder: 'graph.createSubfolder',
    createDatedVoiceTreeFolder: 'graph.createDatedVoiceTreeFolder',
    getStarredFolders: 'graph.getStarredFolders',
    addStarredFolder: 'graph.addStarredFolder',
    removeStarredFolder: 'graph.removeStarredFolder',
    copyNodeToFolder: 'graph.copyNodeToFolder',
} as const

export type GraphGatewayMethodKey = keyof typeof GRAPH_GATEWAY_METHODS
export type GraphGatewayMethodName = (typeof GRAPH_GATEWAY_METHODS)[GraphGatewayMethodKey]

/** Iterable of the dotted names — drift tests assert "every method has a handler". */
export const GRAPH_GATEWAY_METHOD_NAMES: readonly GraphGatewayMethodName[] =
    Object.values(GRAPH_GATEWAY_METHODS)

// ---------------------------------------------------------------------------
// Boot (combined one-round-trip read)
// ---------------------------------------------------------------------------

/**
 * Combined boot read: ensures VTD's single graphd session exists (idempotent),
 * starts the projectedGraph live pump, and returns everything the browser needs
 * to render the first frame in ONE round-trip. The granular reads below remain
 * available for refresh paths.
 */
export namespace GraphOpenProject {
    export type Request = Record<string, never>
    export interface Response {
        readonly sessionId: string
        readonly projectState: ProjectState
        readonly initialProjectedGraph: ProjectedGraph
    }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export namespace GraphGetProject {
    export type Request = Record<string, never>
    export type Response = ProjectState
}

/**
 * Whole-graph snapshot. Over the wire the `Graph`-level Map indexes
 * (`incomingEdgesIndex`, `nodeByBaseName`, `unresolvedLinksIndex`) serialize as
 * plain objects and `nodes` as a record; the consumer rehydrates the Maps the
 * same way the daemon-side `normalizeDaemonGraph` does.
 */
export namespace GraphGetGraph {
    export type Request = Record<string, never>
    export type Response = Graph
}

/** Single-node read — server-side index avoids shipping the whole `Graph`. */
export namespace GraphGetNode {
    export interface Request {
        readonly nodeId: string
    }
    export type Response = GraphNode | null
}

export namespace GraphGetProjectedGraph {
    export type Request = Record<string, never>
    export type Response = ProjectedGraph
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export namespace GraphApplyDelta {
    export interface Request {
        readonly delta: GraphDelta
        readonly recordForUndo?: boolean
    }
    export type Response = VoidResponse
}

export namespace GraphWriteMarkdownFile {
    export interface Request {
        readonly absolutePath: string
        readonly body: string
        readonly editorId: string
    }
    export interface Response {
        readonly ok: true
        readonly absolutePath: string
        readonly preservedSuffix: string | null
    }
}

export namespace GraphWritePositions {
    export interface Request {
        readonly positions: Record<string, Position>
    }
    export interface Response {
        readonly written: number
    }
}

export namespace GraphFindFileByName {
    export interface Request {
        readonly name: string
    }
    export type Response = readonly string[]
}

export namespace GraphGetPreviewContainedNodeIds {
    export interface Request {
        readonly nodeId: string
    }
    export type Response = readonly string[]
}

export namespace GraphCreateContextNode {
    export interface Request {
        readonly parentNodeId: string
        readonly semanticNodeIds: readonly string[]
    }
    export interface Response {
        readonly nodeId: string
    }
}

export namespace GraphUndo {
    export type Request = Record<string, never>
    export type Response = boolean
}

export namespace GraphRedo {
    export type Request = Record<string, never>
    export type Response = boolean
}

export namespace GraphSetWriteFolderPath {
    export interface Request {
        readonly path: string
    }
    export type Response = ProjectState
}

// ---------------------------------------------------------------------------
// Views — discrete typed methods (no generic mutateView(action))
// ---------------------------------------------------------------------------

export namespace GraphListViews {
    export type Request = Record<string, never>
    export type Response = readonly ViewRecord[]
}

export namespace GraphActivateView {
    export interface Request {
        readonly viewId: string
    }
    export type Response = ViewRecord
}

/**
 * Clone a view. Carries the destination `name` explicitly — the old browser
 * `mutateView(id,'clone')` posted no name (a latent bug against
 * `views.clone(src, dstName)`). Agent C supplies it.
 */
export namespace GraphCloneView {
    export interface Request {
        readonly srcViewId: string
        readonly name: string
    }
    export type Response = ViewRecord
}

export namespace GraphDeleteView {
    export interface Request {
        readonly viewId: string
    }
    export type Response = VoidResponse
}

// ---------------------------------------------------------------------------
// Folders — the browser-mode daemon-served folder browser. The browser never
// touches the filesystem; VTD owns FS and serves these scoped to the project's
// allowlisted roots (project root + read paths). Domain shapes are imported
// from `@vt/graph-model/folders`; the small mutation-result records are declared
// here so the contract stays the single source of truth for the wire shape.
// ---------------------------------------------------------------------------

/**
 * The full folder-tree sidebar payload for the current project — root tree,
 * starred-folder trees, external read-path trees — plus the project paths the
 * renderer's ProjectPathStore needs. The browser pulls this on project:ready
 * and after each folder/path mutation and pushes it into the same stores the
 * Electron main process feeds.
 */
export namespace GraphGetFolderTreeSync {
    export type Request = Record<string, never>
    export interface Response {
        readonly rootTree: FolderTreeNode | null
        readonly starredFolders: readonly string[]
        readonly starredTrees: Record<string, FolderTreeNode>
        readonly externalTrees: Record<string, FolderTreeNode>
        readonly readPaths: readonly string[]
        readonly writeFolderPath: string
    }
}

/** "Add folder" selector results for a search query, scoped to the allowlist. */
export namespace GraphGetAvailableFolders {
    export interface Request {
        readonly searchQuery: string
    }
    export type Response = readonly AvailableFolderItem[]
}

/**
 * Recursive directory listing under an allowlisted root (null if disallowed).
 * The wire carries a RAW scan (plain-string paths) — the daemon serves what its
 * filesystem edge produced; clients brand it to the renderer-facing
 * `DirectoryEntry` at their own boundary (graph-model owns the brand).
 */
export namespace GraphGetDirectoryTree {
    export interface Request {
        readonly rootPath: string
        readonly maxDepth?: number
    }
    export type Response = RawDirectoryEntry | null
}

/** Result of a folder-creation mutation. */
export interface FolderMutationResult {
    readonly success: boolean
    readonly path?: string
    readonly error?: string
}

export namespace GraphCreateSubfolder {
    export interface Request {
        readonly parentPath: string
        readonly folderName: string
    }
    export type Response = FolderMutationResult
}

export namespace GraphCreateDatedVoiceTreeFolder {
    export type Request = Record<string, never>
    export type Response = FolderMutationResult
}

export namespace GraphGetStarredFolders {
    export type Request = Record<string, never>
    export type Response = readonly string[]
}

export namespace GraphAddStarredFolder {
    export interface Request {
        readonly folderPath: string
    }
    export type Response = VoidResponse
}

export namespace GraphRemoveStarredFolder {
    export interface Request {
        readonly folderPath: string
    }
    export type Response = VoidResponse
}

export namespace GraphCopyNodeToFolder {
    export interface Request {
        readonly nodeId: string
        readonly targetFolderPath: string
    }
    export interface Response {
        readonly success: boolean
        readonly targetPath: string
        readonly error?: string
    }
}
