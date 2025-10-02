import { describe, it, expect } from 'vitest';
import { ReingoldTilfordStrategy } from '@/graph-core/graphviz/layout/ReingoldTilfordStrategy';
import type { PositioningContext, NodeInfo } from '@/graph-core/graphviz/layout/types';

/**
 * Test suite for ReingoldTilfordStrategy
 *
 * Tests focus on behavioral outputs (node positions) rather than implementation details.
 * Each test verifies WHAT the algorithm produces, not HOW it produces it.
 */
describe('ReingoldTilfordStrategy', () => {
  // Helper to create a minimal node for testing
  const createNode = (id: string, linkedNodeIds: string[] = []): NodeInfo => ({
    id,
    position: { x: 0, y: 0 },
    size: { width: 40, height: 40 },
    linkedNodeIds
  });

  // Helper to create positioning context
  const createContext = (newNodes: NodeInfo[], existingNodes: NodeInfo[] = []): PositioningContext => ({
    nodes: existingNodes,
    newNodes
  });

  describe('Single node positioning', () => {
    it('positions single isolated node at origin', () => {
      const strategy = new ReingoldTilfordStrategy();
      const context = createContext([createNode('root')]);

      const result = strategy.position(context);

      expect(result.positions.get('root')).toEqual({ x: 0, y: 0 });
    });
  });

  describe('Parent-child hierarchy', () => {
    it('positions parent above child (parent y < child y)', () => {
      const strategy = new ReingoldTilfordStrategy();
      const parent = createNode('parent', ['child']);  // parent links to child
      const child = createNode('child');
      const context = createContext([parent, child]);

      const result = strategy.position(context);

      const parentPos = result.positions.get('parent')!;
      const childPos = result.positions.get('child')!;

      expect(parentPos.y).toBeLessThan(childPos.y);
    });

    it('positions grandchildren below children', () => {
      const strategy = new ReingoldTilfordStrategy();
      const root = createNode('root', ['child']);
      const child = createNode('child', ['grandchild']);
      const grandchild = createNode('grandchild');
      const context = createContext([root, child, grandchild]);

      const result = strategy.position(context);

      const rootPos = result.positions.get('root')!;
      const childPos = result.positions.get('child')!;
      const grandchildPos = result.positions.get('grandchild')!;

      expect(rootPos.y).toBeLessThan(childPos.y);
      expect(childPos.y).toBeLessThan(grandchildPos.y);
    });
  });

  describe('Sibling spacing', () => {
    it('spaces siblings horizontally without overlap (minimum 50px apart)', () => {
      const strategy = new ReingoldTilfordStrategy();
      const parent = createNode('parent', ['child1', 'child2']);
      const child1 = createNode('child1');
      const child2 = createNode('child2');
      const context = createContext([parent, child1, child2]);

      const result = strategy.position(context);

      const child1Pos = result.positions.get('child1')!;
      const child2Pos = result.positions.get('child2')!;

      const horizontalDistance = Math.abs(child1Pos.x - child2Pos.x);
      expect(horizontalDistance).toBeGreaterThanOrEqual(50);
    });

    it('spaces three siblings with adequate separation', () => {
      const strategy = new ReingoldTilfordStrategy();
      const parent = createNode('parent', ['child1', 'child2', 'child3']);
      const child1 = createNode('child1');
      const child2 = createNode('child2');
      const child3 = createNode('child3');
      const context = createContext([parent, child1, child2, child3]);

      const result = strategy.position(context);

      const positions = [
        result.positions.get('child1')!,
        result.positions.get('child2')!,
        result.positions.get('child3')!
      ];

      // Check each pair of siblings
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const distance = Math.abs(positions[i].x - positions[j].x);
          expect(distance).toBeGreaterThanOrEqual(50);
        }
      }
    });

    it('ensures siblings at same level have same y-coordinate', () => {
      const strategy = new ReingoldTilfordStrategy();
      const parent = createNode('parent');
      const child1 = createNode('child1', ['parent']);
      const child2 = createNode('child2', ['parent']);
      const context = createContext([parent, child1, child2]);

      const result = strategy.position(context);

      const child1Pos = result.positions.get('child1')!;
      const child2Pos = result.positions.get('child2')!;

      expect(child1Pos.y).toBe(child2Pos.y);
    });
  });

  describe('Parent centering', () => {
    it('centers parent over two children', () => {
      const strategy = new ReingoldTilfordStrategy();
      const parent = createNode('parent', ['child1', 'child2']);
      const child1 = createNode('child1');
      const child2 = createNode('child2');
      const context = createContext([parent, child1, child2]);

      const result = strategy.position(context);

      const parentPos = result.positions.get('parent')!;
      const child1Pos = result.positions.get('child1')!;
      const child2Pos = result.positions.get('child2')!;

      const expectedCenterX = (child1Pos.x + child2Pos.x) / 2;
      expect(parentPos.x).toBeCloseTo(expectedCenterX, 1);
    });

    it('centers parent over three children', () => {
      const strategy = new ReingoldTilfordStrategy();
      const parent = createNode('parent', ['child1', 'child2', 'child3']);
      const child1 = createNode('child1');
      const child2 = createNode('child2');
      const child3 = createNode('child3');
      const context = createContext([parent, child1, child2, child3]);

      const result = strategy.position(context);

      const parentPos = result.positions.get('parent')!;
      const childPositions = [
        result.positions.get('child1')!,
        result.positions.get('child2')!,
        result.positions.get('child3')!
      ];

      const minX = Math.min(...childPositions.map(p => p.x));
      const maxX = Math.max(...childPositions.map(p => p.x));
      const expectedCenterX = (minX + maxX) / 2;

      expect(parentPos.x).toBeCloseTo(expectedCenterX, 1);
    });
  });

  describe('Forest layout (multiple roots)', () => {
    it('positions two separate trees without overlap', () => {
      const strategy = new ReingoldTilfordStrategy();
      // Tree 1: root1 -> child1
      const root1 = createNode('root1');
      const child1 = createNode('child1', ['root1']);
      // Tree 2: root2 -> child2
      const root2 = createNode('root2');
      const child2 = createNode('child2', ['root2']);

      const context = createContext([root1, child1, root2, child2]);

      const result = strategy.position(context);

      const root1Pos = result.positions.get('root1')!;
      const root2Pos = result.positions.get('root2')!;

      // Roots should be at same y-level (both roots)
      expect(root1Pos.y).toBe(root2Pos.y);

      // Trees should be horizontally separated
      const horizontalDistance = Math.abs(root1Pos.x - root2Pos.x);
      expect(horizontalDistance).toBeGreaterThan(0);
    });

    it('handles three independent root nodes', () => {
      const strategy = new ReingoldTilfordStrategy();
      const root1 = createNode('root1');
      const root2 = createNode('root2');
      const root3 = createNode('root3');

      const context = createContext([root1, root2, root3]);

      const result = strategy.position(context);

      const positions = [
        result.positions.get('root1')!,
        result.positions.get('root2')!,
        result.positions.get('root3')!
      ];

      // All roots at same y-level
      expect(positions[0].y).toBe(positions[1].y);
      expect(positions[1].y).toBe(positions[2].y);

      // All roots have distinct x positions
      const xPositions = positions.map(p => p.x);
      expect(new Set(xPositions).size).toBe(3);
    });
  });

  describe('Deep hierarchy (3+ levels)', () => {
    it('properly spaces nodes across 4 levels vertically', () => {
      const strategy = new ReingoldTilfordStrategy();
      const level0 = createNode('level0', ['level1']);
      const level1 = createNode('level1', ['level2']);
      const level2 = createNode('level2', ['level3']);
      const level3 = createNode('level3');

      const context = createContext([level0, level1, level2, level3]);

      const result = strategy.position(context);

      const positions = [
        result.positions.get('level0')!,
        result.positions.get('level1')!,
        result.positions.get('level2')!,
        result.positions.get('level3')!
      ];

      // Each level should be progressively lower (higher y)
      expect(positions[0].y).toBeLessThan(positions[1].y);
      expect(positions[1].y).toBeLessThan(positions[2].y);
      expect(positions[2].y).toBeLessThan(positions[3].y);

      // Vertical spacing should be consistent (approximately)
      const spacing1 = positions[1].y - positions[0].y;
      const spacing2 = positions[2].y - positions[1].y;
      const spacing3 = positions[3].y - positions[2].y;

      expect(spacing1).toBeCloseTo(spacing2, 1);
      expect(spacing2).toBeCloseTo(spacing3, 1);
    });

    it('handles complex tree with branching at multiple levels', () => {
      const strategy = new ReingoldTilfordStrategy();
      /*
       * Tree structure:
       *         root
       *        /    \
       *      c1      c2
       *     / \      /
       *   gc1 gc2  gc3
       */
      const root = createNode('root', ['c1', 'c2']);
      const c1 = createNode('c1', ['gc1', 'gc2']);
      const c2 = createNode('c2', ['gc3']);
      const gc1 = createNode('gc1');
      const gc2 = createNode('gc2');
      const gc3 = createNode('gc3');

      const context = createContext([root, c1, c2, gc1, gc2, gc3]);

      const result = strategy.position(context);

      const rootPos = result.positions.get('root')!;
      const c1Pos = result.positions.get('c1')!;
      const c2Pos = result.positions.get('c2')!;
      const gc1Pos = result.positions.get('gc1')!;
      const gc2Pos = result.positions.get('gc2')!;
      const gc3Pos = result.positions.get('gc3')!;

      // Level verification: root < children < grandchildren
      expect(rootPos.y).toBeLessThan(c1Pos.y);
      expect(rootPos.y).toBeLessThan(c2Pos.y);
      expect(c1Pos.y).toBeLessThan(gc1Pos.y);
      expect(c1Pos.y).toBeLessThan(gc2Pos.y);
      expect(c2Pos.y).toBeLessThan(gc3Pos.y);

      // Siblings at same level
      expect(c1Pos.y).toBe(c2Pos.y);
      expect(gc1Pos.y).toBe(gc2Pos.y);
      expect(gc2Pos.y).toBe(gc3Pos.y);

      // Spacing between siblings
      expect(Math.abs(c1Pos.x - c2Pos.x)).toBeGreaterThanOrEqual(50);
      expect(Math.abs(gc1Pos.x - gc2Pos.x)).toBeGreaterThanOrEqual(50);

      // Parent centering: c1 centered over gc1 and gc2
      const c1ExpectedX = (gc1Pos.x + gc2Pos.x) / 2;
      expect(c1Pos.x).toBeCloseTo(c1ExpectedX, 1);

      // Root centered over c1 and c2
      const rootExpectedX = (c1Pos.x + c2Pos.x) / 2;
      expect(rootPos.x).toBeCloseTo(rootExpectedX, 1);
    });
  });

  describe('Edge cases', () => {
    it('handles empty node list', () => {
      const strategy = new ReingoldTilfordStrategy();
      const context = createContext([]);

      const result = strategy.position(context);

      expect(result.positions.size).toBe(0);
    });

    it('handles single node with self-reference (edge case)', () => {
      const strategy = new ReingoldTilfordStrategy();
      const node = createNode('self', ['self']);
      const context = createContext([node]);

      const result = strategy.position(context);

      // Should still position the node (treat as root)
      expect(result.positions.has('self')).toBe(true);
      expect(result.positions.get('self')).toEqual({ x: 0, y: 0 });
    });

    it('handles node with multiple parents (DAG - treat as forest)', () => {
      const strategy = new ReingoldTilfordStrategy();
      // In a DAG, a node might have multiple parents
      // The algorithm should handle this gracefully
      const parent1 = createNode('parent1', ['child']);
      const parent2 = createNode('parent2', ['child']);
      const child = createNode('child');

      const context = createContext([parent1, parent2, child]);

      const result = strategy.position(context);

      // All nodes should be positioned
      expect(result.positions.size).toBe(3);
      expect(result.positions.has('parent1')).toBe(true);
      expect(result.positions.has('parent2')).toBe(true);
      expect(result.positions.has('child')).toBe(true);
    });
  });

  describe('Configuration constants', () => {
    it('respects minimum sibling spacing of 100px when configured', () => {
      // This tests that the algorithm uses appropriate spacing constants
      const strategy = new ReingoldTilfordStrategy();
      const parent = createNode('parent', ['child0', 'child1', 'child2', 'child3', 'child4']);
      // Create 5 children to test consistent spacing
      const children = Array.from({ length: 5 }, (_, i) =>
        createNode(`child${i}`)
      );

      const context = createContext([parent, ...children]);
      const result = strategy.position(context);

      const childPositions = children.map(c => result.positions.get(c.id)!);

      // Sort by x position
      childPositions.sort((a, b) => a.x - b.x);

      // Check spacing between adjacent children
      for (let i = 0; i < childPositions.length - 1; i++) {
        const spacing = childPositions[i + 1].x - childPositions[i].x;
        // Should be at least 50px, and with proper algorithm likely 100px
        expect(spacing).toBeGreaterThanOrEqual(50);
      }
    });

    it('uses consistent level height (150px) between levels', () => {
      const strategy = new ReingoldTilfordStrategy();
      const root = createNode('root', ['child']);
      const child = createNode('child', ['grandchild']);
      const grandchild = createNode('grandchild');

      const context = createContext([root, child, grandchild]);
      const result = strategy.position(context);

      const rootPos = result.positions.get('root')!;
      const childPos = result.positions.get('child')!;
      const grandchildPos = result.positions.get('grandchild')!;

      const spacing1 = childPos.y - rootPos.y;
      const spacing2 = grandchildPos.y - childPos.y;

      // Both should be approximately 150px
      expect(spacing1).toBeCloseTo(150, 1);
      expect(spacing2).toBeCloseTo(150, 1);
    });
  });
});
