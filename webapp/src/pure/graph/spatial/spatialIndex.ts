/**
 * Pure spatial index module using dual R-trees (nodes + edges).
 *
 * Generic rectangle indexing — no cytoscape, no Position, no ObstacleBBox.
 * Only dependency: rbush.
 *
 * Functions operate on an opaque SpatialIndex handle. No class, no `this`.
 */

import RBush from 'rbush';

// ============================================================================
// Types
// ============================================================================

/** The only shape this module knows about. */
export interface Rect {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
}

/** Node bounding box entry. */
export interface SpatialNodeEntry extends Rect {
    readonly nodeId: string;
}

/** Edge segment AABB entry with actual endpoints for fine-grained checks. */
export interface SpatialEdgeEntry extends Rect {
    readonly edgeId: string;
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
}

/** Opaque handle — callers cannot reach into rbush internals. */
export interface SpatialIndex {
    readonly _brand: unique symbol;
}

/** Internal representation behind the opaque handle. */
interface SpatialIndexInternal {
    readonly nodeTree: RBush<SpatialNodeEntry>;
    readonly edgeTree: RBush<SpatialEdgeEntry>;
}

// ============================================================================
// Internal helpers
// ============================================================================

function toInternal(index: SpatialIndex): SpatialIndexInternal {
    return index as unknown as SpatialIndexInternal;
}

function toOpaque(internal: SpatialIndexInternal): SpatialIndex {
    return internal as unknown as SpatialIndex;
}

function nodeEquals(a: SpatialNodeEntry, b: SpatialNodeEntry): boolean {
    return a.nodeId === b.nodeId;
}

function edgeEquals(a: SpatialEdgeEntry, b: SpatialEdgeEntry): boolean {
    return a.edgeId === b.edgeId;
}

// ============================================================================
// Construction
// ============================================================================

/** Create a spatial index by bulk-loading nodes and edges. O(n log n). */
export function createSpatialIndex(
    nodes: readonly SpatialNodeEntry[],
    edges: readonly SpatialEdgeEntry[]
): SpatialIndex {
    const nodeTree: RBush<SpatialNodeEntry> = new RBush<SpatialNodeEntry>();
    nodeTree.load(nodes);

    const edgeTree: RBush<SpatialEdgeEntry> = new RBush<SpatialEdgeEntry>();
    edgeTree.load(edges);

    return toOpaque({ nodeTree, edgeTree });
}

// ============================================================================
// Queries (pure: index in, data out, no mutation)
// ============================================================================

/** Return all node entries whose AABB intersects the given rect. */
export function queryNodesInRect(index: SpatialIndex, rect: Rect): readonly SpatialNodeEntry[] {
    return toInternal(index).nodeTree.search(rect);
}

/** Return all edge entries whose AABB intersects the given rect. */
export function queryEdgesInRect(index: SpatialIndex, rect: Rect): readonly SpatialEdgeEntry[] {
    return toInternal(index).edgeTree.search(rect);
}

/** Fast boolean: does any node AABB intersect the given rect? Uses rbush.collides(). */
export function hasNodeCollision(index: SpatialIndex, rect: Rect): boolean {
    return toInternal(index).nodeTree.collides(rect);
}

/** Fast boolean: does any edge AABB intersect the given rect? */
export function hasEdgeCollision(index: SpatialIndex, rect: Rect): boolean {
    return toInternal(index).edgeTree.collides(rect);
}

/** Return both node and edge entries intersecting the rect. */
export function findObstacles(
    index: SpatialIndex,
    rect: Rect
): { readonly nodes: readonly SpatialNodeEntry[]; readonly edges: readonly SpatialEdgeEntry[] } {
    return {
        nodes: queryNodesInRect(index, rect),
        edges: queryEdgesInRect(index, rect),
    };
}

// ============================================================================
// Mutation (impure: called from shell only)
// ============================================================================

/** Insert a single node entry. O(log n). */
export function insertNode(index: SpatialIndex, entry: SpatialNodeEntry): void {
    toInternal(index).nodeTree.insert(entry);
}

/** Remove a single node entry by nodeId. O(log n). */
export function removeNode(index: SpatialIndex, entry: SpatialNodeEntry): void {
    toInternal(index).nodeTree.remove(entry, nodeEquals);
}

/** Insert a single edge entry. O(log n). */
export function insertEdge(index: SpatialIndex, entry: SpatialEdgeEntry): void {
    toInternal(index).edgeTree.insert(entry);
}

/** Remove a single edge entry by edgeId. O(log n). */
export function removeEdge(index: SpatialIndex, entry: SpatialEdgeEntry): void {
    toInternal(index).edgeTree.remove(entry, edgeEquals);
}
