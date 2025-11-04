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
  readonly broadcast: (graph: Graph) => void
}

// ============================================================================
// Domain Model
// ============================================================================

export type NodeId = string

export interface GraphNode {
  readonly id: NodeId
  readonly title: string
  readonly content: string
  readonly summary: string
  readonly color: O.Option<string>
}

export interface Graph {
  readonly nodes: Record<NodeId, GraphNode>
  readonly edges: Record<NodeId, readonly NodeId[]> // Adjacency list
}

// ============================================================================
// Actions (User-initiated changes)
// ============================================================================

export interface Position {
  readonly x: number
  readonly y: number
}

export interface CreateNode {
  readonly type: 'CreateNode'
  readonly nodeId: NodeId
  readonly content: string
  readonly position: O.Option<Position>
}

export interface UpdateNode {
  readonly type: 'UpdateNode'
  readonly nodeId: NodeId
  readonly content: string
}

export interface DeleteNode {
  readonly type: 'DeleteNode'
  readonly nodeId: NodeId
}

export type NodeAction = CreateNode | UpdateNode | DeleteNode

// ============================================================================
// External Events (Filesystem changes)
// ============================================================================

export type FSEventType = 'Added' | 'Changed' | 'Deleted'

export interface FSUpdate {
  readonly path: string
  readonly content: string
  readonly eventType: FSEventType
}

// ============================================================================
// Effects (Side effects to be executed)
// ============================================================================

/**
 * App effect: computation that needs environment, is async, and can fail
 *
 * ReaderTaskEither<Env, Error, A> means:
 * - Reader: needs Env to run
 * - Task: async computation
 * - Either: can succeed with A or fail with Error
 */
export type AppEffect<A> = RTE.ReaderTaskEither<Env, Error, A>

/**
 * Pure Reader effect: needs environment but is synchronous
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
  readonly nodesToUpdate: ReadonlyArray<{ readonly id: string; readonly data: any }>
  readonly nodesToRemove: ReadonlyArray<string>
  readonly edgesToAdd: ReadonlyArray<CytoscapeEdgeElement>
  readonly edgesToRemove: ReadonlyArray<string>
}
