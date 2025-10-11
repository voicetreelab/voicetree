import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TidyLayoutStrategy } from '@/graph-core/graphviz/layout/TidyLayoutStrategy';
import type { NodeInfo } from '@/graph-core/graphviz/layout/types';
import { Tidy } from '@/graph-core/wasm-tidy/wasm';

describe('TidyLayoutStrategy', () => {
  let strategy: TidyLayoutStrategy;

  beforeEach(() => {
    strategy = new TidyLayoutStrategy();
  });

  describe('Ghost Root Behavior', () => {
    it('should not return ghost root in position results', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      const positions = await strategy.fullBuild(nodes);

      // Ghost should never appear in returned positions
      expect(positions.has('__GHOST_ROOT__')).toBe(false);
      // But our actual node should be positioned
      expect(positions.has('node1')).toBe(true);
    });

    it('should parent orphan nodes to ghost root', async () => {
      const orphan1: NodeInfo = {
        id: 'orphan1',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };
      const orphan2: NodeInfo = {
        id: 'orphan2',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };

      const positions = await strategy.fullBuild([orphan1, orphan2]);

      // Both orphans should be positioned (implicitly parented to ghost)
      expect(positions.has('orphan1')).toBe(true);
      expect(positions.has('orphan2')).toBe(true);
      // And ghost should not appear
      expect(positions.has('__GHOST_ROOT__')).toBe(false);
    });

    it('should handle mix of orphans and parented nodes', async () => {
      const nodes: NodeInfo[] = [
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
        { id: 'orphan', position: { x: 0, y: 0 }, size: { width: 90, height: 45 } }
      ];

      const positions = await strategy.fullBuild(nodes);

      expect(positions.has('root')).toBe(true);
      expect(positions.has('child')).toBe(true);
      expect(positions.has('orphan')).toBe(true);
      expect(positions.has('__GHOST_ROOT__')).toBe(false);
    });
  });

  describe('ID Mapping Stability', () => {
    it('should maintain stable string to numeric ID mappings across calls', async () => {
      const node1: NodeInfo = {
        id: 'stable-node',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };

      // First build
      const positions1 = await strategy.fullBuild([node1]);
      const pos1 = positions1.get('stable-node')!;

      // Second build with same node
      const positions2 = await strategy.fullBuild([node1]);
      const pos2 = positions2.get('stable-node')!;

      // Positions should be identical (same ID mapping used)
      expect(pos1.x).toBe(pos2.x);
      expect(pos1.y).toBe(pos2.y);
    });

    it('should maintain mappings when adding new nodes incrementally', async () => {
      const initialNodes: NodeInfo[] = [
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'node2', position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, parentId: 'node1' }
      ];

      await strategy.fullBuild(initialNodes);

      // Add new node
      const newNode: NodeInfo = {
        id: 'node3',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 },
        parentId: 'node2'
      };

      const positions = await strategy.addNodes([newNode]);

      // All nodes should be present
      expect(positions.has('node1')).toBe(true);
      expect(positions.has('node2')).toBe(true);
      expect(positions.has('node3')).toBe(true);
    });
  });

  describe('Full Build', () => {
    it('should position a single node', async () => {
      const node: NodeInfo = {
        id: 'single',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };

      const positions = await strategy.fullBuild([node]);

      expect(positions.size).toBe(1);
      expect(positions.has('single')).toBe(true);
      const pos = positions.get('single')!;
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
    });

    it('should position a simple parent-child tree', async () => {
      const nodes: NodeInfo[] = [
        { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' },
        { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
      ];

      const positions = await strategy.fullBuild(nodes);

      expect(positions.size).toBe(3);
      expect(positions.has('parent')).toBe(true);
      expect(positions.has('child1')).toBe(true);
      expect(positions.has('child2')).toBe(true);

      // Parent should be left of children (smaller x value) in left-right orientation
      const parentX = positions.get('parent')!.x;
      const child1X = positions.get('child1')!.x;
      const child2X = positions.get('child2')!.x;
      expect(parentX).toBeLessThan(child1X);
      expect(parentX).toBeLessThan(child2X);
    });

    it('should handle multi-level hierarchy', async () => {
      const nodes: NodeInfo[] = [
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
        { id: 'grandchild', position: { x: 0, y: 0 }, size: { width: 60, height: 30 }, parentId: 'child' }
      ];

      const positions = await strategy.fullBuild(nodes);

      expect(positions.size).toBe(3);

      const rootX = positions.get('root')!.x;
      const childX = positions.get('child')!.x;
      const grandchildX = positions.get('grandchild')!.x;

      // Should be horizontally ordered in left-right orientation
      expect(rootX).toBeLessThan(childX);
      expect(childX).toBeLessThan(grandchildX);
    });

    it('should return empty map for empty input', async () => {
      const positions = await strategy.fullBuild([]);
      expect(positions.size).toBe(0);
    });

    it('should handle disconnected components', async () => {
      const nodes: NodeInfo[] = [
        { id: 'tree1-root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'tree1-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'tree1-root' },
        { id: 'tree2-root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'tree2-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'tree2-root' }
      ];

      const positions = await strategy.fullBuild(nodes);

      expect(positions.size).toBe(4);
      // Both trees should be positioned
      expect(positions.has('tree1-root')).toBe(true);
      expect(positions.has('tree1-child')).toBe(true);
      expect(positions.has('tree2-root')).toBe(true);
      expect(positions.has('tree2-child')).toBe(true);
    });
  });

  describe('Incremental Layout with addNodes', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should call partial_layout when adding nodes incrementally', async () => {
      // Setup: perform fullBuild on single root
      const rootNode: NodeInfo = {
        id: 'root',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };

      await strategy.fullBuild([rootNode]);

      // Spy on Tidy methods
      const partialLayoutSpy = vi.spyOn(Tidy.prototype, 'partial_layout');
      const layoutSpy = vi.spyOn(Tidy.prototype, 'layout');

      // Add one child node
      const childNode: NodeInfo = {
        id: 'child',
        position: { x: 0, y: 0 },
        size: { width: 80, height: 40 },
        parentId: 'root'
      };

      await strategy.addNodes([childNode]);

      // Expect partial_layout to have been called once and layout not called
      expect(partialLayoutSpy).toHaveBeenCalledOnce();
      expect(layoutSpy).not.toHaveBeenCalled();
    });

    it('should add a new child to existing tree', async () => {
      const initialNodes: NodeInfo[] = [
        { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
      ];

      await strategy.fullBuild(initialNodes);

      const newNode: NodeInfo = {
        id: 'child2',
        position: { x: 0, y: 0 },
        size: { width: 80, height: 40 },
        parentId: 'parent'
      };

      const positions = await strategy.addNodes([newNode]);

      // All nodes should be positioned
      expect(positions.size).toBeGreaterThanOrEqual(3);
      expect(positions.has('parent')).toBe(true);
      expect(positions.has('child1')).toBe(true);
      expect(positions.has('child2')).toBe(true);
    });

    it('should add multiple new nodes at once', async () => {
      const initialNodes: NodeInfo[] = [
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      await strategy.fullBuild(initialNodes);

      const newNodes: NodeInfo[] = [
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
        { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
      ];

      const positions = await strategy.addNodes(newNodes);

      expect(positions.has('root')).toBe(true);
      expect(positions.has('child1')).toBe(true);
      expect(positions.has('child2')).toBe(true);
    });

    it('should add orphan nodes incrementally', async () => {
      const initialNodes: NodeInfo[] = [
        { id: 'existing', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      await strategy.fullBuild(initialNodes);

      const newOrphan: NodeInfo = {
        id: 'orphan',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };

      const positions = await strategy.addNodes([newOrphan]);

      expect(positions.has('existing')).toBe(true);
      expect(positions.has('orphan')).toBe(true);
    });

    it('should handle adding nodes without prior fullBuild', async () => {
      // This tests resilience - strategy should handle this gracefully
      const newNode: NodeInfo = {
        id: 'first',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };

      const positions = await strategy.addNodes([newNode]);

      // Should position the node (may fall back to full build)
      expect(positions.has('first')).toBe(true);
    });
  });

  describe('Legacy Wikilink Support', () => {
    it('should use linkedNodeIds as parent when no parentId specified', async () => {
      const nodes: NodeInfo[] = [
        { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        {
          id: 'child',
          position: { x: 0, y: 0 },
          size: { width: 80, height: 40 },
          linkedNodeIds: ['parent', 'other']
        }
      ];

      const positions = await strategy.fullBuild(nodes);

      expect(positions.size).toBe(2);

      // Child should be to the right of parent (left-right orientation)
      const parentX = positions.get('parent')!.x;
      const childX = positions.get('child')!.x;
      expect(childX).toBeGreaterThan(parentX);
    });

    it('should prefer parentId over linkedNodeIds', async () => {
      const nodes: NodeInfo[] = [
        { id: 'actualParent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'linkedNode', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        {
          id: 'child',
          position: { x: 0, y: 0 },
          size: { width: 80, height: 40 },
          parentId: 'actualParent',
          linkedNodeIds: ['linkedNode']
        }
      ];

      const positions = await strategy.fullBuild(nodes);

      expect(positions.size).toBe(3);

      // Child should be to the right of actualParent, not linkedNode (left-right orientation)
      const actualParentX = positions.get('actualParent')!.x;
      const childX = positions.get('child')!.x;
      expect(childX).toBeGreaterThan(actualParentX);
    });
  });

  describe('WASM Instance Persistence', () => {
    it('should reuse same WASM instance across fullBuild and addNodes', async () => {
      const initialNodes: NodeInfo[] = [
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      await strategy.fullBuild(initialNodes);

      const newNode: NodeInfo = {
        id: 'node2',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 },
        parentId: 'node1'
      };

      // This should use partial_layout() on the same instance
      const positions = await strategy.addNodes([newNode]);

      expect(positions.has('node1')).toBe(true);
      expect(positions.has('node2')).toBe(true);
    });

    it('should maintain state through multiple incremental updates', async () => {
      await strategy.fullBuild([
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ]);

      await strategy.addNodes([
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
      ]);

      const positions = await strategy.addNodes([
        { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
      ]);

      expect(positions.has('root')).toBe(true);
      expect(positions.has('child1')).toBe(true);
      expect(positions.has('child2')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle node with reference to non-existent parent', async () => {
      const nodes: NodeInfo[] = [
        {
          id: 'orphan',
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
          parentId: 'non-existent'
        }
      ];

      const positions = await strategy.fullBuild(nodes);

      // Should treat as orphan (parent to ghost)
      expect(positions.has('orphan')).toBe(true);
      expect(positions.size).toBe(1);
    });

    it('should handle self-referencing node', async () => {
      const nodes: NodeInfo[] = [
        {
          id: 'self-ref',
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
          parentId: 'self-ref'
        }
      ];

      const positions = await strategy.fullBuild(nodes);

      // Should treat as orphan (ignore self-reference)
      expect(positions.has('self-ref')).toBe(true);
    });

    it('should handle nodes with zero dimensions', async () => {
      const nodes: NodeInfo[] = [
        { id: 'zero-width', position: { x: 0, y: 0 }, size: { width: 0, height: 50 } },
        { id: 'zero-height', position: { x: 0, y: 0 }, size: { width: 100, height: 0 } }
      ];

      const positions = await strategy.fullBuild(nodes);

      expect(positions.has('zero-width')).toBe(true);
      expect(positions.has('zero-height')).toBe(true);
    });
  });

  describe('isEmpty() method', () => {
    it('should return true for new instance', async () => {
      expect(strategy.isEmpty()).toBe(true);
    });

    it('should return false after fullBuild', async () => {
      await strategy.fullBuild([
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ]);
      expect(strategy.isEmpty()).toBe(false);
    });

    it('should return true after fullBuild with empty array', async () => {
      await strategy.fullBuild([]);
      expect(strategy.isEmpty()).toBe(true);
    });
  });

  describe('position() method (unified interface)', () => {
    it('should use fullBuild for initial layout', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      const result = await strategy.position({ nodes, newNodes: [] });

      expect(result.positions.has('node1')).toBe(true);
    });

    it('should use addNodes for incremental updates', async () => {
      // Initial setup
      await strategy.fullBuild([
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ]);

      // Incremental add via position()
      const newNode: NodeInfo = {
        id: 'child',
        position: { x: 0, y: 0 },
        size: { width: 80, height: 40 },
        parentId: 'root'
      };

      const result = await strategy.position({ nodes: [], newNodes: [newNode] });

      expect(result.positions.has('root')).toBe(true);
      expect(result.positions.has('child')).toBe(true);
    });

    it('should handle both nodes and newNodes together on initial load', async () => {
      const existingNodes: NodeInfo[] = [
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];
      const newNodes: NodeInfo[] = [
        { id: 'node2', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      const result = await strategy.position({ nodes: existingNodes, newNodes });

      expect(result.positions.has('node1')).toBe(true);
      expect(result.positions.has('node2')).toBe(true);
    });
  });

  describe('Left-Right Orientation', () => {
    it('should position children to the RIGHT of parent (not below)', async () => {
      const nodes: NodeInfo[] = [
        { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' },
        { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
      ];

      const positions = await strategy.fullBuild(nodes);

      // Parent should be LEFT of children (smaller x value)
      const parentX = positions.get('parent')!.x;
      const child1X = positions.get('child1')!.x;
      const child2X = positions.get('child2')!.x;

      expect(parentX).toBeLessThan(child1X);
      expect(parentX).toBeLessThan(child2X);
    });

    it('should grow multi-level hierarchy horizontally (left to right)', async () => {
      const nodes: NodeInfo[] = [
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
        { id: 'grandchild', position: { x: 0, y: 0 }, size: { width: 60, height: 30 }, parentId: 'child' }
      ];

      const positions = await strategy.fullBuild(nodes);

      const rootX = positions.get('root')!.x;
      const childX = positions.get('child')!.x;
      const grandchildX = positions.get('grandchild')!.x;

      // Should be horizontally ordered: root → child → grandchild
      expect(rootX).toBeLessThan(childX);
      expect(childX).toBeLessThan(grandchildX);
    });

    it('should separate siblings vertically at same depth level', async () => {
      const nodes: NodeInfo[] = [
        { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' },
        { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
      ];

      const positions = await strategy.fullBuild(nodes);

      const child1Pos = positions.get('child1')!;
      const child2Pos = positions.get('child2')!;

      // Siblings should have different Y (vertically separated)
      expect(child1Pos.y).not.toBe(child2Pos.y);

      // But similar X (same depth level, allowing for minor layout differences)
      const xDiff = Math.abs(child1Pos.x - child2Pos.x);
      expect(xDiff).toBeLessThan(50); // Allow small variance
    });

    it('should position disconnected trees side-by-side instead of stacked', async () => {
      const nodes: NodeInfo[] = [
        { id: 'tree1-root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'tree1-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'tree1-root' },
        { id: 'tree2-root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'tree2-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'tree2-root' }
      ];

      const positions = await strategy.fullBuild(nodes);

      const tree1RootPos = positions.get('tree1-root')!;
      const tree2RootPos = positions.get('tree2-root')!;

      // Trees should be separated vertically (different Y), not horizontally
      const yDiff = Math.abs(tree1RootPos.y - tree2RootPos.y);
      expect(yDiff).toBeGreaterThan(50);
    });

    it('should maintain left-right orientation in incremental updates', async () => {
      const initialNodes: NodeInfo[] = [
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
      ];

      await strategy.fullBuild(initialNodes);

      const newNode: NodeInfo = {
        id: 'child2',
        position: { x: 0, y: 0 },
        size: { width: 80, height: 40 },
        parentId: 'root'
      };

      const positions = await strategy.addNodes([newNode]);

      // Root should still be left of all children
      const rootX = positions.get('root')!.x;
      const child1X = positions.get('child1')!.x;
      const child2X = positions.get('child2')!.x;

      expect(rootX).toBeLessThan(child1X);
      expect(rootX).toBeLessThan(child2X);
    });
  });
});
