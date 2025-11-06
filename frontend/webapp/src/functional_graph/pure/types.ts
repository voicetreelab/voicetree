import * as O from 'fp-ts/lib/Option.js'
import * as RTE from 'fp-ts/lib/ReaderTaskEither.js'
import * as R from 'fp-ts/lib/Reader.js'

/**
 * Core pure model for the functional graph architecture
 */

// ============================================================================
// Environment (Dependencies)
// ============================================================================

/**
 * Runtime environment containing all IO dependencies
 * This is the Reader monad's environment
 */
export interface Env {
    readonly vaultPath: string
}
export type FilePath = string // todo enforce only / and chars

// ============================================================================
// Domain Model
// ============================================================================

export type NodeId = FilePath

export interface Position {
    readonly x: number // from top left of canvas origin?
    readonly y: number
}

export interface NodeUIMetadata {
    // readonly title: string //todo, derived from content? first #+, otherwise file slug
    // todo complexity is that we don't want markdown title to be big if it's also visually on graph
    // we could make markdown title # small <-- best CHOSEN
    // or use another markdown character to represent title,
    readonly color: O.Option<string>
    readonly position: Position
    // width/height is derived from node degree

}
export interface Node {
    // CORE GRAPH STRUCTURE
    readonly outgoingEdges: readonly NodeId[] // Adjacency list to children / outgoing outgoingEdges
    // incomingEdges is derived
    readonly relativeFilePathIsID: NodeId //  we enforce relativeFilePathIsID = relativeFilePath

    // DATA
    readonly content: string

    // visual METADATA
    readonly nodeUIMetadata: NodeUIMetadata

    // FS DB METADATA
    // readonly fileName:  (filePath: FilePath) => string, derived
}

export interface Graph {
    readonly nodes: Record<NodeId, Node>
}

// ============================================================================
// Actions (User-initiated changes)
// ============================================================================


export interface CreateEmptyNodeFromUIInteraction {
    readonly type: 'CreateNodeFromUIInteraction'
    readonly createsIncomingEdges: readonly NodeId[] // from parent to child
}
// note, we could just pass this straight in to apply graph action to db
// but keeping it separate for now to have a bit more customisability

export interface UpdateNodeContent {
    readonly type: 'UpdateNode'
    readonly nodeId: NodeId
    readonly content: string
} // mapped to UpsertNodeAction


// so we hvae two options.
// in frontend impure edge, at ui interaction, we can either send through a UpdateNodeContent to backend
// or we can call getNode(nodeId) from backend, map to an Upsert, and then call an UpsertNodeContent.


export interface UpsertNodeAction {
    readonly type: 'UpsertNode'
    readonly nodeToUpsert: Node
}

export interface DeleteNode {
    readonly type: 'DeleteNode'
    readonly nodeId: NodeId
}

export type NodeDelta = UpsertNodeAction | DeleteNode
export type GraphDelta = readonly NodeDelta[];

// ============================================================================
// External Events (Filesystem changes)
// ============================================================================

export type FSEvent = FSUpdate | FSDelete

export interface FSUpdate {
    readonly absolutePath: FilePath
    readonly content: string
    readonly eventType: 'Added' | 'Changed' | 'Deleted'
}

export interface FSDelete {readonly absolutePath: FilePath}


// ============================================================================
// Effects (Side effects to be executed)
// ============================================================================

/**
 * Filesystem write effect: async operation that writes to disk
 *
 * Used for user-initiated actions that modify files (create/update/delete nodes).
 * These effects:
 * - Write to filesystem (requires vaultPath from Env)
 * - Are async (TaskEither)
 * - Can fail with Error
 * - Return computed result (but IPC handlers should ignore it - file watch handlers own state)
 *
 * ReaderTaskEither<Env, Error, A> means:
 * - Reader: needs Env to run
 * - Task: async computation
 * - Either: can succeed with A or fail with Error
 */
export type FSWriteEffect<A> = RTE.ReaderTaskEither<Env, Error, A>

/**
 * Generic app effect (alias for backwards compatibility)
 * Prefer FSWriteEffect for filesystem operations
 */
export type AppEffect<A> = FSWriteEffect<A>

/**
 * Pure Reader effect: needs environment but is synchronous
 *
 * Used for pure computations that need config (vaultPath) but don't perform IO.
 * File watch handlers use this to update graph state from filesystem events.
 */
export type EnvReader<A> = R.Reader<Env, A>

// ============================================================================
// Cytoscape Projection Types
// ============================================================================

export interface CytoscapeNodeElement {
    readonly data: {
        readonly id: string
        readonly label: string
        readonly content: string
        readonly summary: string
        readonly color: string | undefined
    }
}

export interface CytoscapeEdgeElement {
    readonly data: {
        readonly id: string
        readonly source: string
        readonly target: string
        readonly label?: string
    }
}

export interface CytoscapeElements {
    readonly nodes: ReadonlyArray<CytoscapeNodeElement>
    readonly edges: ReadonlyArray<CytoscapeEdgeElement>
}

/**
 * Diff between current Cytoscape state and desired state.
 * Describes what operations are needed to reconcile the DOM.
 */
export interface CytoscapeDiff {
    readonly nodesToAdd: ReadonlyArray<CytoscapeNodeElement>
    readonly nodesToUpdate: ReadonlyArray<{ readonly id: string; readonly data: Partial<CytoscapeNodeElement['data']> }>
    readonly nodesToRemove: ReadonlyArray<string>
    readonly edgesToAdd: ReadonlyArray<CytoscapeEdgeElement>
    readonly edgesToRemove: ReadonlyArray<string>
}
