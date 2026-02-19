import { describe, it, expect } from 'vitest';
import {
    createSpatialIndex,
    queryNodesInRect,
    queryEdgesInRect,
    hasNodeCollision,
    hasEdgeCollision,
    findObstacles,
    insertNode,
    removeNode,
    insertEdge,
    removeEdge,
} from './spatialIndex';
import type { SpatialNodeEntry, SpatialEdgeEntry, Rect, SpatialIndex } from './spatialIndex';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(id: string, x: number, y: number, w: number, h: number): SpatialNodeEntry {
    return { nodeId: id, minX: x, minY: y, maxX: x + w, maxY: y + h };
}

function makeEdge(id: string, x1: number, y1: number, x2: number, y2: number): SpatialEdgeEntry {
    return {
        edgeId: id,
        x1, y1, x2, y2,
        minX: Math.min(x1, x2),
        minY: Math.min(y1, y2),
        maxX: Math.max(x1, x2),
        maxY: Math.max(y1, y2),
    };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('spatialIndex', () => {
    describe('createSpatialIndex + queries', () => {
        it('should return empty results for an empty index', () => {
            const idx: SpatialIndex = createSpatialIndex([], []);
            const searchRect: Rect = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
            expect(queryNodesInRect(idx, searchRect)).toEqual([]);
            expect(queryEdgesInRect(idx, searchRect)).toEqual([]);
            expect(hasNodeCollision(idx, searchRect)).toBe(false);
            expect(hasEdgeCollision(idx, searchRect)).toBe(false);
        });

        it('should find nodes within the search rect', () => {
            const nodes: readonly SpatialNodeEntry[] = [
                makeNode('a', 0, 0, 100, 50),
                makeNode('b', 200, 200, 100, 50),
                makeNode('c', 500, 500, 100, 50),
            ];
            const idx: SpatialIndex = createSpatialIndex(nodes, []);

            const searchRect: Rect = { minX: -10, minY: -10, maxX: 150, maxY: 100 };
            const found: readonly SpatialNodeEntry[] = queryNodesInRect(idx, searchRect);
            expect(found).toHaveLength(1);
            expect(found[0].nodeId).toBe('a');
        });

        it('should find edges within the search rect', () => {
            const edges: readonly SpatialEdgeEntry[] = [
                makeEdge('e1', 0, 0, 100, 100),
                makeEdge('e2', 300, 300, 400, 400),
            ];
            const idx: SpatialIndex = createSpatialIndex([], edges);

            const searchRect: Rect = { minX: 50, minY: 50, maxX: 150, maxY: 150 };
            const found: readonly SpatialEdgeEntry[] = queryEdgesInRect(idx, searchRect);
            expect(found).toHaveLength(1);
            expect(found[0].edgeId).toBe('e1');
        });

        it('should find both nodes and edges via findObstacles', () => {
            const nodes: readonly SpatialNodeEntry[] = [makeNode('n1', 10, 10, 50, 50)];
            const edges: readonly SpatialEdgeEntry[] = [makeEdge('e1', 0, 0, 100, 100)];
            const idx: SpatialIndex = createSpatialIndex(nodes, edges);

            const searchRect: Rect = { minX: 0, minY: 0, maxX: 80, maxY: 80 };
            const result: { readonly nodes: readonly SpatialNodeEntry[]; readonly edges: readonly SpatialEdgeEntry[] } = findObstacles(idx, searchRect);
            expect(result.nodes).toHaveLength(1);
            expect(result.edges).toHaveLength(1);
        });
    });

    describe('hasNodeCollision / hasEdgeCollision', () => {
        it('should return true when rect intersects a node', () => {
            const idx: SpatialIndex = createSpatialIndex([makeNode('a', 0, 0, 100, 50)], []);
            expect(hasNodeCollision(idx, { minX: 50, minY: 25, maxX: 200, maxY: 100 })).toBe(true);
        });

        it('should return false when rect does not intersect any node', () => {
            const idx: SpatialIndex = createSpatialIndex([makeNode('a', 0, 0, 100, 50)], []);
            expect(hasNodeCollision(idx, { minX: 200, minY: 200, maxX: 300, maxY: 300 })).toBe(false);
        });

        it('should return true when rect intersects an edge AABB', () => {
            const idx: SpatialIndex = createSpatialIndex([], [makeEdge('e1', 0, 0, 100, 100)]);
            expect(hasEdgeCollision(idx, { minX: 50, minY: 50, maxX: 150, maxY: 150 })).toBe(true);
        });

        it('should return false when rect does not intersect any edge AABB', () => {
            const idx: SpatialIndex = createSpatialIndex([], [makeEdge('e1', 0, 0, 100, 100)]);
            expect(hasEdgeCollision(idx, { minX: 200, minY: 200, maxX: 300, maxY: 300 })).toBe(false);
        });
    });

    describe('insertNode / removeNode', () => {
        it('should allow inserting a node after creation', () => {
            const idx: SpatialIndex = createSpatialIndex([], []);
            const node: SpatialNodeEntry = makeNode('new', 50, 50, 100, 100);
            insertNode(idx, node);

            const found: readonly SpatialNodeEntry[] = queryNodesInRect(idx, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
            expect(found).toHaveLength(1);
            expect(found[0].nodeId).toBe('new');
        });

        it('should allow removing a node by nodeId', () => {
            const node: SpatialNodeEntry = makeNode('removable', 50, 50, 100, 100);
            const idx: SpatialIndex = createSpatialIndex([node], []);

            expect(queryNodesInRect(idx, { minX: 0, minY: 0, maxX: 200, maxY: 200 })).toHaveLength(1);
            removeNode(idx, node);
            expect(queryNodesInRect(idx, { minX: 0, minY: 0, maxX: 200, maxY: 200 })).toHaveLength(0);
        });

        it('should correctly remove only the specified node when multiple exist', () => {
            const a: SpatialNodeEntry = makeNode('a', 0, 0, 50, 50);
            const b: SpatialNodeEntry = makeNode('b', 100, 100, 50, 50);
            const idx: SpatialIndex = createSpatialIndex([a, b], []);

            removeNode(idx, a);
            const remaining: readonly SpatialNodeEntry[] = queryNodesInRect(idx, { minX: -50, minY: -50, maxX: 200, maxY: 200 });
            expect(remaining).toHaveLength(1);
            expect(remaining[0].nodeId).toBe('b');
        });
    });

    describe('insertEdge / removeEdge', () => {
        it('should allow inserting an edge after creation', () => {
            const idx: SpatialIndex = createSpatialIndex([], []);
            const edge: SpatialEdgeEntry = makeEdge('e-new', 0, 0, 200, 200);
            insertEdge(idx, edge);

            const found: readonly SpatialEdgeEntry[] = queryEdgesInRect(idx, { minX: 50, minY: 50, maxX: 150, maxY: 150 });
            expect(found).toHaveLength(1);
            expect(found[0].edgeId).toBe('e-new');
        });

        it('should allow removing an edge by edgeId', () => {
            const edge: SpatialEdgeEntry = makeEdge('e-rm', 10, 10, 90, 90);
            const idx: SpatialIndex = createSpatialIndex([], [edge]);

            expect(queryEdgesInRect(idx, { minX: 0, minY: 0, maxX: 100, maxY: 100 })).toHaveLength(1);
            removeEdge(idx, edge);
            expect(queryEdgesInRect(idx, { minX: 0, minY: 0, maxX: 100, maxY: 100 })).toHaveLength(0);
        });
    });

    describe('bulk load performance', () => {
        it('should handle bulk loading 1000 nodes without error', () => {
            const nodes: readonly SpatialNodeEntry[] = Array.from({ length: 1000 }, (_, i) =>
                makeNode(`n${i}`, i * 10, i * 10, 50, 30)
            );
            const idx: SpatialIndex = createSpatialIndex(nodes, []);
            const all: readonly SpatialNodeEntry[] = queryNodesInRect(idx, { minX: -1, minY: -1, maxX: 10001, maxY: 10001 });
            expect(all).toHaveLength(1000);
        });

        it('should return correct subset from a large index', () => {
            const nodes: readonly SpatialNodeEntry[] = Array.from({ length: 500 }, (_, i) =>
                makeNode(`n${i}`, i * 20, i * 20, 10, 10)
            );
            const idx: SpatialIndex = createSpatialIndex(nodes, []);

            // Search a small window that should contain only a few nodes
            const found: readonly SpatialNodeEntry[] = queryNodesInRect(idx, { minX: 95, minY: 95, maxX: 115, maxY: 115 });
            // Nodes at x=100 (n5) through x=110 (n5, possibly n6 if overlapping)
            expect(found.length).toBeGreaterThan(0);
            expect(found.length).toBeLessThan(20);
        });
    });

    describe('edge cases', () => {
        it('should handle nodes at the same position', () => {
            const a: SpatialNodeEntry = makeNode('a', 0, 0, 100, 100);
            const b: SpatialNodeEntry = makeNode('b', 0, 0, 100, 100);
            const idx: SpatialIndex = createSpatialIndex([a, b], []);
            const found: readonly SpatialNodeEntry[] = queryNodesInRect(idx, { minX: -1, minY: -1, maxX: 101, maxY: 101 });
            expect(found).toHaveLength(2);
        });

        it('should handle zero-width point entries', () => {
            const node: SpatialNodeEntry = { nodeId: 'point', minX: 50, minY: 50, maxX: 50, maxY: 50 };
            const idx: SpatialIndex = createSpatialIndex([node], []);
            // Search rect that contains the point
            expect(hasNodeCollision(idx, { minX: 49, minY: 49, maxX: 51, maxY: 51 })).toBe(true);
            // Search rect that doesn't contain the point
            expect(hasNodeCollision(idx, { minX: 51, minY: 51, maxX: 100, maxY: 100 })).toBe(false);
        });

        it('should handle negative coordinates', () => {
            const node: SpatialNodeEntry = makeNode('neg', -200, -200, 100, 100);
            const idx: SpatialIndex = createSpatialIndex([node], []);
            const found: readonly SpatialNodeEntry[] = queryNodesInRect(idx, { minX: -250, minY: -250, maxX: -50, maxY: -50 });
            expect(found).toHaveLength(1);
            expect(found[0].nodeId).toBe('neg');
        });
    });
});
