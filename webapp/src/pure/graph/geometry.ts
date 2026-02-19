/**
 * Pure geometry primitives for graph layout decisions.
 *
 * Provides segment intersection testing (extracted from findBestPosition.ts)
 * and a composed layout-correction predicate used to gate local Cola runs.
 * No cytoscape dependency — operates on plain EdgeSegment and Rect types.
 */

import type { Position } from '@/pure/graph';
import type { Rect } from '@/pure/graph/spatial';

// ============================================================================
// Types
// ============================================================================

export interface EdgeSegment {
    readonly p1: Position;
    readonly p2: Position;
}

export interface LocalGeometry {
    readonly newEdges: readonly EdgeSegment[];
    readonly existingEdges: readonly EdgeSegment[];
    readonly newNodeRects: readonly Rect[];
    readonly neighborRects: readonly Rect[];
}

// ============================================================================
// Internal helpers (not exported)
// ============================================================================

const EPSILON: number = 1e-6;

/** Cross product of vectors (p2-p1) × (p3-p1). */
function cross(p1: Position, p2: Position, p3: Position): number {
    return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
}

/** Check if point q lies on segment pr (when all three are collinear). */
function onSegment(p: Position, q: Position, r: Position): boolean {
    return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
           q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}

/** Check if two points are approximately equal. */
function pointsEqual(a: Position, b: Position): boolean {
    return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

function anyNewEdgeCrossesExisting(
    newSegs: readonly EdgeSegment[],
    existing: readonly EdgeSegment[]
): boolean {
    return newSegs.some(n => existing.some(e => segmentsIntersect(n, e)));
}

function anyRectsOverlap(
    targets: readonly Rect[],
    others: readonly Rect[]
): boolean {
    return targets.some(t => others.some(o =>
        t.minX < o.maxX && t.maxX > o.minX
     && t.minY < o.maxY && t.maxY > o.minY
    ));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if two line segments properly intersect.
 * Segments sharing an endpoint are NOT considered intersecting
 * (handles parent→child edges sharing the parent node).
 */
export function segmentsIntersect(a: EdgeSegment, b: EdgeSegment): boolean {
    if (pointsEqual(a.p1, b.p1) || pointsEqual(a.p1, b.p2) ||
        pointsEqual(a.p2, b.p1) || pointsEqual(a.p2, b.p2)) {
        return false;
    }

    const d1: number = cross(b.p1, b.p2, a.p1);
    const d2: number = cross(b.p1, b.p2, a.p2);
    const d3: number = cross(a.p1, a.p2, b.p1);
    const d4: number = cross(a.p1, a.p2, b.p2);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }

    if (Math.abs(d1) < EPSILON && onSegment(b.p1, a.p1, b.p2)) return true;
    if (Math.abs(d2) < EPSILON && onSegment(b.p1, a.p2, b.p2)) return true;
    if (Math.abs(d3) < EPSILON && onSegment(a.p1, b.p1, a.p2)) return true;
    if (Math.abs(d4) < EPSILON && onSegment(a.p1, b.p2, a.p2)) return true;

    return false;
}

/**
 * Determine whether a local geometry requires layout correction.
 * Returns true if any new edge crosses an existing edge, or any new node
 * rect overlaps a neighbor rect.
 */
export function needsLayoutCorrection(geo: LocalGeometry): boolean {
    return anyNewEdgeCrossesExisting(geo.newEdges, geo.existingEdges)
        || anyRectsOverlap(geo.newNodeRects, geo.neighborRects);
}

/**
 * Check if any pair of edge segments in the list cross each other.
 * O(n²) brute force — acceptable for the local region (typically <50 edges).
 * Segments sharing an endpoint are excluded (parent→child edges sharing a node).
 */
export function hasEdgeCrossingsAmong(edges: readonly EdgeSegment[]): boolean {
    return edges.some((a: EdgeSegment, i: number) =>
        edges.slice(i + 1).some((b: EdgeSegment) => segmentsIntersect(a, b))
    );
}
