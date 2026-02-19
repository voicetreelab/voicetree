import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core, NodeSingular, EdgeSingular } from 'cytoscape';
import { enableSpatialIndex, getCurrentIndex } from './spatialIndexSync';
import { queryNodesInRect, queryEdgesInRect } from '@/pure/graph/spatial';
import type { SpatialIndex, SpatialNodeEntry, SpatialEdgeEntry } from '@/pure/graph/spatial';

describe('spatialIndexSync', () => {
    let cy: Core;
    let cleanup: () => void;

    beforeEach(() => {
        cy = cytoscape({
            headless: true,
            elements: [
                { data: { id: 'a' }, position: { x: 0, y: 0 } },
                { data: { id: 'b' }, position: { x: 100, y: 100 } },
                { data: { id: 'c' }, position: { x: 200, y: 200 } },
                { data: { source: 'a', target: 'b' } },
                { data: { source: 'b', target: 'c' } },
            ],
        });
        cleanup = enableSpatialIndex(cy);
    });

    afterEach(() => {
        cleanup();
        cy.destroy();
    });

    it('builds an index on enable', () => {
        const index: SpatialIndex | undefined = getCurrentIndex(cy);
        expect(index).toBeDefined();
    });

    it('indexes all nodes', () => {
        const index: SpatialIndex = getCurrentIndex(cy)!;
        const nodes: readonly SpatialNodeEntry[] = queryNodesInRect(index, { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
        const ids: string[] = nodes.map(n => n.nodeId).sort();
        expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('indexes all edges', () => {
        const index: SpatialIndex = getCurrentIndex(cy)!;
        const edges: readonly SpatialEdgeEntry[] = queryEdgesInRect(index, { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
        expect(edges).toHaveLength(2);
    });

    it('incrementally adds a node', () => {
        cy.add({ data: { id: 'd' }, position: { x: 500, y: 500 } });
        const index: SpatialIndex = getCurrentIndex(cy)!;
        const nodes: readonly SpatialNodeEntry[] = queryNodesInRect(index, { minX: 490, minY: 490, maxX: 510, maxY: 510 });
        const ids: string[] = nodes.map(n => n.nodeId);
        expect(ids).toContain('d');
    });

    it('incrementally removes a node', () => {
        cy.getElementById('c').remove();
        const index: SpatialIndex = getCurrentIndex(cy)!;
        const nodes: readonly SpatialNodeEntry[] = queryNodesInRect(index, { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
        const ids: string[] = nodes.map(n => n.nodeId);
        expect(ids).not.toContain('c');
    });

    it('incrementally adds an edge', () => {
        cy.add({ data: { id: 'e-ac', source: 'a', target: 'c' } });
        const index: SpatialIndex = getCurrentIndex(cy)!;
        const edges: readonly SpatialEdgeEntry[] = queryEdgesInRect(index, { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
        const edgeIds: string[] = edges.map(e => e.edgeId);
        expect(edgeIds).toContain('e-ac');
    });

    it('incrementally removes an edge', () => {
        const edgeBefore: EdgeSingular = cy.edges().first();
        const edgeId: string = edgeBefore.id();
        edgeBefore.remove();
        const index: SpatialIndex = getCurrentIndex(cy)!;
        const edges: readonly SpatialEdgeEntry[] = queryEdgesInRect(index, { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
        const edgeIds: string[] = edges.map(e => e.edgeId);
        expect(edgeIds).not.toContain(edgeId);
    });

    it('rebuilds on layoutstop', () => {
        // Move node a to new position
        (cy.getElementById('a') as NodeSingular).position({ x: 999, y: 999 });

        // Fire layoutstop to trigger rebuild with new positions
        cy.emit('layoutstop');

        const after: readonly SpatialNodeEntry[] = queryNodesInRect(getCurrentIndex(cy)!, { minX: 990, minY: 990, maxX: 1010, maxY: 1010 });
        const afterIds: string[] = after.map(n => n.nodeId);
        expect(afterIds).toContain('a');
    });

    it('cleanup removes the index', () => {
        cleanup();
        expect(getCurrentIndex(cy)).toBeUndefined();
        // Re-assign cleanup to no-op since it was already called
        cleanup = () => {};
    });

    it('returns undefined for an untracked cy instance', () => {
        const otherCy: Core = cytoscape({ headless: true });
        expect(getCurrentIndex(otherCy)).toBeUndefined();
        otherCy.destroy();
    });
});
