/**
 * BF-138 · L0-A — Unified data-layer contract (TYPES ONLY).
 *
 * Authoritative public surface for every L1 consumer:
 *   • cytoscape shell (webapp)  — stateful, subscribes to deltas
 *   • `vt-graph` CLI            — stateless, reads a snapshot
 *   • live MCP client           — remote {getLiveState, dispatchLiveCommand}
 *
 * NO implementation. All exported values are `declare`s. Impl lands BF-142+.
 *
 * Invariants (verified in L1, not typed here):
 *   • F6 aggregation (folder-nodes/design.md decision 3) — project() on a
 *     State with a non-empty collapseSet emits synthetic edges matching
 *     computeSyntheticEdgeSpecs (@vt/graph-tools/folderCollapse).
 *   • Additive-friendly: L1 may extend State and Command without breaking
 *     existing consumers (see decisions.md §7).
 *   • ElementSpec is cytoscape-shaped but NOT typed against cytoscape —
 *     the shell assumption must not leak into this package.
 */

import type {
    Graph, GraphNode, Edge, NodeIdAndFilePath, Position,
} from '@vt/graph-model/pure/graph'
import type { FolderTreeNode, GraphDelta } from '@vt/graph-model'

// ============================================================================
// STATE
// ============================================================================

/** Absolute folder path with a trailing slash (matches folderCollapse.ts). */
export type FolderId = string

/** A vault / loaded root (absolute directory path, no trailing slash). */
export type RootPath = string

/**
 * Layout. `positions` persists on disk today (see decisions.md §6).
 * `zoom`/`pan` are render-only in v1 but live on State so CLI can read
 * "what the user currently sees" without a second IPC hop. Shells may
 * ignore them.
 */
export interface StateLayout {
    readonly positions: ReadonlyMap<NodeIdAndFilePath, Position>
    readonly zoom?: number
    readonly pan?: Position
    readonly fit?: { readonly paddingPx: number } | null
}

export interface StateMetadata {
    readonly schemaVersion: 1
    /** Monotonic counter, bumped by every applyCommand. */
    readonly revision: number
    readonly mutatedAt?: string
}

export interface StateRoots {
    readonly loaded: ReadonlySet<RootPath>
    /** Derived from loaded roots via folder-tree walk. */
    readonly folderTree: readonly FolderTreeNode[]
}

/**
 * Single source of truth for everything UI + CLI both render.
 * No cytoscape / Electron / DOM types.
 */
export interface State {
    readonly graph: Graph
    readonly roots: StateRoots
    readonly collapseSet: ReadonlySet<FolderId>
    readonly selection: ReadonlySet<NodeIdAndFilePath>
    readonly layout: StateLayout
    readonly meta: StateMetadata
}

// ============================================================================
// COMMANDS
// ============================================================================

export interface Collapse   { readonly type: 'Collapse';   readonly folder: FolderId }
export interface Expand     { readonly type: 'Expand';     readonly folder: FolderId }
export interface Select     { readonly type: 'Select';     readonly ids: readonly NodeIdAndFilePath[]; readonly additive?: boolean }
export interface Deselect   { readonly type: 'Deselect';   readonly ids: readonly NodeIdAndFilePath[] }
export interface AddNode    { readonly type: 'AddNode';    readonly node: GraphNode }
export interface RemoveNode { readonly type: 'RemoveNode'; readonly id: NodeIdAndFilePath }
export interface AddEdge    { readonly type: 'AddEdge';    readonly source: NodeIdAndFilePath; readonly edge: Edge }
export interface RemoveEdge { readonly type: 'RemoveEdge'; readonly source: NodeIdAndFilePath; readonly targetId: NodeIdAndFilePath }
export interface Move       { readonly type: 'Move';       readonly id: NodeIdAndFilePath; readonly to: Position }
export interface LoadRoot   { readonly type: 'LoadRoot';   readonly root: RootPath }
export interface UnloadRoot { readonly type: 'UnloadRoot'; readonly root: RootPath }

export type Command =
    | Collapse | Expand
    | Select | Deselect
    | AddNode | RemoveNode
    | AddEdge | RemoveEdge
    | Move
    | LoadRoot | UnloadRoot

// ============================================================================
// DELTAS (change-notification)
// ============================================================================

/**
 * Minimal change description returned by applyCommand and by subscribe().
 * See decisions.md §4 (change-notification model).
 */
export interface Delta {
    readonly revision: number                // new State.meta.revision
    readonly cause: Command
    readonly graph?: GraphDelta              // node+edge adds/removes
    readonly collapseAdded?:    readonly FolderId[]
    readonly collapseRemoved?:  readonly FolderId[]
    readonly selectionAdded?:   readonly NodeIdAndFilePath[]
    readonly selectionRemoved?: readonly NodeIdAndFilePath[]
    readonly rootsLoaded?:      readonly RootPath[]
    readonly rootsUnloaded?:    readonly RootPath[]
    readonly positionsMoved?:   ReadonlyMap<NodeIdAndFilePath, Position>
}

/** Branded numeric alias for state.meta.revision. Opaque by contract. */
export type ChangeToken = number & { readonly __brand: 'ChangeToken' }

export type Unsubscribe = () => void
export type Subscription = (delta: Delta) => void

// ============================================================================
// PROJECTION (cytoscape-neutral)
// ============================================================================

export interface NodeElement {
    readonly id: NodeIdAndFilePath | FolderId
    readonly parent?: FolderId
    readonly label?: string
    readonly data: Readonly<Record<string, unknown>>
    readonly position?: Position
    readonly classes?: readonly string[]
    readonly kind: 'node' | 'folder' | 'folder-collapsed'
}

export interface EdgeElement {
    readonly id: string
    readonly source: NodeIdAndFilePath | FolderId
    readonly target: NodeIdAndFilePath | FolderId
    readonly label?: string
    readonly data: Readonly<Record<string, unknown>>
    readonly classes?: readonly string[]
    readonly kind: 'real' | 'synthetic'      // 'synthetic' = F6 aggregate
}

export interface ElementSpec {
    readonly nodes: readonly NodeElement[]
    readonly edges: readonly EdgeElement[]
    readonly revision: number
}

// ============================================================================
// PURE API (implemented in BF-142 / BF-143 / BF-144..BF-152)
// ============================================================================

export declare function project(state: State): ElementSpec
export declare function applyCommand(state: State, cmd: Command): State
export declare function applyCommandWithDelta(state: State, cmd: Command): { readonly state: State; readonly delta: Delta }
export declare function emptyState(): State

// ============================================================================
// LIVE (IPC) API — implemented in BF-161 / BF-162 / BF-163
// ============================================================================

/**
 * Transport-agnostic so we can swap MCP → socket/http later without breaking
 * L1 consumers (see decisions.md §5).
 */
export interface LiveTransport {
    readonly getLiveState: () => Promise<State>
    readonly dispatchLiveCommand: (cmd: Command) => Promise<Delta>
    readonly subscribeLive?: (cb: Subscription) => Promise<Unsubscribe>
}

export declare const getLiveState: LiveTransport['getLiveState']
export declare const dispatchLiveCommand: LiveTransport['dispatchLiveCommand']

// ============================================================================
// AGGREGATE (DI bundle)
// ============================================================================

export interface GraphStateAPI {
    readonly project: typeof project
    readonly applyCommand: typeof applyCommand
    readonly applyCommandWithDelta: typeof applyCommandWithDelta
    readonly emptyState: typeof emptyState
    readonly live?: LiveTransport
}
