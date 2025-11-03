import * as O from 'fp-ts/Option'
import * as IO from 'fp-ts/IO'

/**
 * Core domain model for the functional graph architecture
 */

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
 * Database IO effect - writes to filesystem
 */
export type DBIO<A = void> = IO.IO<A>

/**
 * UI IO effect - broadcasts to renderer
 */
export type UIIO<A = void> = IO.IO<A>

// ============================================================================
// Cytoscape Projection Types
// ============================================================================

export interface CytoscapeNodeElement {
  readonly data: {
    readonly id: string
    readonly label: string
    readonly content: string
    readonly summary: string
    readonly color: O.Option<string>
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
