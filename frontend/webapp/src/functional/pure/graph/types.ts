import * as O from 'fp-ts/lib/Option.js'
import * as RTE from 'fp-ts/lib/ReaderTaskEither.js'
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
    readonly title: string // Computed from frontmatter title, first heading, or filename
    readonly color: O.Option<string>
    readonly position: O.Option<Position>
    // width/height is derived from node degree

}
export interface GraphNode {
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
    readonly nodes: Record<NodeId, GraphNode>
}

// ============================================================================
// Actions (User-initiated changes)
// ============================================================================

export interface UpsertNodeAction {
    readonly type: 'UpsertNode'
    readonly nodeToUpsert: GraphNode
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
