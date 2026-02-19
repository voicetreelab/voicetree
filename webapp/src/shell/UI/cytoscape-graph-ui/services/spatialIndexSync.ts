/**
 * Shell sync adapter: cytoscape ↔ spatial index lifecycle.
 *
 * Owns the mutable SpatialIndex instance. Converts cytoscape nodes/edges
 * to spatial entries. Rebuilds on layoutstop, incremental updates on
 * add/remove. Exposes getCurrentIndex() for shell consumers.
 *
 * This is the only file that calls insert/remove on the spatial index.
 */

import type { Core, NodeSingular, EdgeSingular, EventObject } from 'cytoscape';
import {
    createSpatialIndex,
    insertNode,
    removeNode,
    insertEdge,
    removeEdge,
} from '@/pure/graph/spatial';
import type {
    SpatialIndex,
    SpatialNodeEntry,
    SpatialEdgeEntry,
} from '@/pure/graph/spatial';

// ============================================================================
// Converters: cytoscape → spatial entries
// ============================================================================

function cyNodeToEntry(node: NodeSingular): SpatialNodeEntry {
    const pos: { x: number; y: number } = node.position();
    const w: number = node.outerWidth();
    const h: number = node.outerHeight();
    return {
        minX: pos.x - w / 2,
        minY: pos.y - h / 2,
        maxX: pos.x + w / 2,
        maxY: pos.y + h / 2,
        nodeId: node.id(),
    };
}

function cyEdgeToEntry(edge: EdgeSingular): SpatialEdgeEntry {
    const sp: { x: number; y: number } = edge.source().position();
    const tp: { x: number; y: number } = edge.target().position();
    return {
        minX: Math.min(sp.x, tp.x),
        minY: Math.min(sp.y, tp.y),
        maxX: Math.max(sp.x, tp.x),
        maxY: Math.max(sp.y, tp.y),
        edgeId: edge.id(),
        x1: sp.x,
        y1: sp.y,
        x2: tp.x,
        y2: tp.y,
    };
}

// ============================================================================
// Per-instance state (keyed by cy instance)
// ============================================================================

const indices: Map<Core, SpatialIndex> = new Map();

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the current spatial index for a cytoscape instance.
 * Returns undefined if enableSpatialIndex has not been called for this cy.
 */
export function getCurrentIndex(cy: Core): SpatialIndex | undefined {
    return indices.get(cy);
}

/**
 * Full rebuild: collect all nodes and edges, bulk-load a new index.
 * Called on layoutstop and during initial setup.
 */
function rebuildIndex(cy: Core): void {
    const nodeEntries: SpatialNodeEntry[] = cy.nodes().map(cyNodeToEntry);
    const edgeEntries: SpatialEdgeEntry[] = cy.edges().map(cyEdgeToEntry);
    indices.set(cy, createSpatialIndex(nodeEntries, edgeEntries));
}

/** Force a full spatial index rebuild. Call after animations that bypass layoutstop. */
export function refreshSpatialIndex(cy: Core): void {
    rebuildIndex(cy);
}

/**
 * Enable spatial index syncing for a cytoscape instance.
 *
 * Listens to layoutstop (full rebuild), add/remove node/edge (incremental).
 * Returns a cleanup function to disable syncing and remove the index.
 */
export function enableSpatialIndex(cy: Core): () => void {
    // Initial build
    rebuildIndex(cy);

    // --- Event handlers ---

    const onLayoutStop: () => void = () => {
        rebuildIndex(cy);
    };

    const onAddNode: (evt: EventObject) => void = (evt: EventObject) => {
        const index: SpatialIndex | undefined = indices.get(cy);
        if (!index) return;
        const node: NodeSingular = evt.target as NodeSingular;
        insertNode(index, cyNodeToEntry(node));
    };

    const onRemoveNode: (evt: EventObject) => void = (evt: EventObject) => {
        const index: SpatialIndex | undefined = indices.get(cy);
        if (!index) return;
        const node: NodeSingular = evt.target as NodeSingular;
        removeNode(index, cyNodeToEntry(node));
    };

    const onAddEdge: (evt: EventObject) => void = (evt: EventObject) => {
        const index: SpatialIndex | undefined = indices.get(cy);
        if (!index) return;
        const edge: EdgeSingular = evt.target as EdgeSingular;
        insertEdge(index, cyEdgeToEntry(edge));
    };

    const onRemoveEdge: (evt: EventObject) => void = (evt: EventObject) => {
        const index: SpatialIndex | undefined = indices.get(cy);
        if (!index) return;
        const edge: EdgeSingular = evt.target as EdgeSingular;
        removeEdge(index, cyEdgeToEntry(edge));
    };

    // --- Bind events ---

    cy.on('layoutstop', onLayoutStop);
    cy.on('add', 'node', onAddNode);
    cy.on('remove', 'node', onRemoveNode);
    cy.on('add', 'edge', onAddEdge);
    cy.on('remove', 'edge', onRemoveEdge);

    // --- Cleanup ---

    return () => {
        cy.off('layoutstop', onLayoutStop);
        cy.off('add', 'node', onAddNode);
        cy.off('remove', 'node', onRemoveNode);
        cy.off('add', 'edge', onAddEdge);
        cy.off('remove', 'edge', onRemoveEdge);
        indices.delete(cy);
    };
}
