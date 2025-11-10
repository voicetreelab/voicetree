import * as O from 'fp-ts/lib/Option.js'

// ============================================================================
// DEPRECATED Graph Types (for legacy cytoscape code)
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
    readonly edges: Record<NodeId, readonly NodeId[]>
}

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
