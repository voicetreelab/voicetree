import { describe, it, expect, beforeEach } from 'vitest';
import { TidyLayoutStrategy } from '@/graph-core/graphviz/layout/TidyLayoutStrategy';
import type { NodeInfo } from '@/graph-core/graphviz/layout/types';

describe('TidyLayoutStrategy', () => {
  let strategy: TidyLayoutStrategy;

  beforeEach(() => {
    strategy = new TidyLayoutStrategy();
  });

  describe('Ghost Root Behavior', () => {
    it('should not return ghost root in position results', () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      const positions = strategy.fullBuild(nodes);

      // Ghost should never appear in returned positions
      expect(positions.has('__GHOST_ROOT__')).toBe(false);
      // But our actual node should be positioned
      expect(positions.has('node1')).toBe(true);
    });

    it('should parent orphan nodes to ghost root', () => {
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

      const positions = strategy.fullBuild([orphan1, orphan2]);

      // Both orphans should be positioned (implicitly parented to ghost)
      expect(positions.has('orphan1')).toBe(true);
      expect(positions.has('orphan2')).toBe(true);
      // And ghost should not appear
      expect(positions.has('__GHOST_ROOT__')).toBe(false);
    });

    it('should handle mix of orphans and parented nodes', () => {
      const nodes: NodeInfo[] = [
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
        { id: 'orphan', position: { x: 0, y: 0 }, size: { width: 90, height: 45 } }
      ];

      const positions = strategy.fullBuild(nodes);

      expect(positions.has('root')).toBe(true);
      expect(positions.has('child')).toBe(true);
      expect(positions.has('orphan')).toBe(true);
      expect(positions.has('__GHOST_ROOT__')).toBe(false);
    });
  });

  describe('ID Mapping Stability', () => {
    it('should maintain stable string to numeric ID mappings across calls', () => {
      const node1: NodeInfo = {
        id: 'stable-node',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };

      // First build
      const positions1 = strategy.fullBuild([node1]);
      const pos1 = positions1.get('stable-node')!;

      // Second build with same node
      const positions2 = strategy.fullBuild([node1]);
      const pos2 = positions2.get('stable-node')!;

      // Positions should be identical (same ID mapping used)
      expect(pos1.x).toBe(pos2.x);
      expect(pos1.y).toBe(pos2.y);
    });

    it('should maintain mappings when adding new nodes incrementally', () => {
      const initialNodes: NodeInfo[] = [
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'node2', position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, parentId: 'node1' }
      ];

      strategy.fullBuild(initialNodes);

      // Add new node
      const newNode: NodeInfo = {
        id: 'node3',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 },
        parentId: 'node2'
      };

      const positions = strategy.addNodes([newNode]);

      // All nodes should be present
      expect(positions.has('node1')).toBe(true);
      expect(positions.has('node2')).toBe(true);
      expect(positions.has('node3')).toBe(true);
    });
  });

  describe('Full Build', () => {
    it('should position a single node', () => {
      const node: NodeInfo = {
        id: 'single',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };

      const positions = strategy.fullBuild([node]);

      expect(positions.size).toBe(1);
      expect(positions.has('single')).toBe(true);
      const pos = positions.get('single')!;
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
    });

    it('should position a simple parent-child tree', () => {
      const nodes: NodeInfo[] = [
        { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' },
        { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
      ];

      const positions = strategy.fullBuild(nodes);

      expect(positions.size).toBe(3);
      expect(positions.has('parent')).toBe(true);
      expect(positions.has('child1')).toBe(true);
      expect(positions.has('child2')).toBe(true);

      // Parent should be above children (smaller y value)
      const parentY = positions.get('parent')!.y;
      const child1Y = positions.get('child1')!.y;
      const child2Y = positions.get('child2')!.y;
      expect(parentY).toBeLessThan(child1Y);
      expect(parentY).toBeLessThan(child2Y);
    });

    it('should handle multi-level hierarchy', () => {
      const nodes: NodeInfo[] = [
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
        { id: 'grandchild', position: { x: 0, y: 0 }, size: { width: 60, height: 30 }, parentId: 'child' }
      ];

      const positions = strategy.fullBuild(nodes);

      expect(positions.size).toBe(3);

      const rootY = positions.get('root')!.y;
      const childY = positions.get('child')!.y;
      const grandchildY = positions.get('grandchild')!.y;

      // Should be vertically ordered
      expect(rootY).toBeLessThan(childY);
      expect(childY).toBeLessThan(grandchildY);
    });

    it('should return empty map for empty input', () => {
      const positions = strategy.fullBuild([]);
      expect(positions.size).toBe(0);
    });

    it('should handle disconnected components', () => {
      const nodes: NodeInfo[] = [
        { id: 'tree1-root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'tree1-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'tree1-root' },
        { id: 'tree2-root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'tree2-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'tree2-root' }
      ];

      const positions = strategy.fullBuild(nodes);

      expect(positions.size).toBe(4);
      // Both trees should be positioned
      expect(positions.has('tree1-root')).toBe(true);
      expect(positions.has('tree1-child')).toBe(true);
      expect(positions.has('tree2-root')).toBe(true);
      expect(positions.has('tree2-child')).toBe(true);
    });
  });

  describe('Incremental Layout with addNodes', () => {
    it('should add a new child to existing tree', () => {
      const initialNodes: NodeInfo[] = [
        { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
      ];

      strategy.fullBuild(initialNodes);

      const newNode: NodeInfo = {
        id: 'child2',
        position: { x: 0, y: 0 },
        size: { width: 80, height: 40 },
        parentId: 'parent'
      };

      const positions = strategy.addNodes([newNode]);

      // All nodes should be positioned
      expect(positions.size).toBeGreaterThanOrEqual(3);
      expect(positions.has('parent')).toBe(true);
      expect(positions.has('child1')).toBe(true);
      expect(positions.has('child2')).toBe(true);
    });

    it('should add multiple new nodes at once', () => {
      const initialNodes: NodeInfo[] = [
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      strategy.fullBuild(initialNodes);

      const newNodes: NodeInfo[] = [
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
        { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
      ];

      const positions = strategy.addNodes(newNodes);

      expect(positions.has('root')).toBe(true);
      expect(positions.has('child1')).toBe(true);
      expect(positions.has('child2')).toBe(true);
    });

    it('should add orphan nodes incrementally', () => {
      const initialNodes: NodeInfo[] = [
        { id: 'existing', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      strategy.fullBuild(initialNodes);

      const newOrphan: NodeInfo = {
        id: 'orphan',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };

      const positions = strategy.addNodes([newOrphan]);

      expect(positions.has('existing')).toBe(true);
      expect(positions.has('orphan')).toBe(true);
    });

    it('should handle adding nodes without prior fullBuild', () => {
      // This tests resilience - strategy should handle this gracefully
      const newNode: NodeInfo = {
        id: 'first',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 }
      };

      const positions = strategy.addNodes([newNode]);

      // Should position the node (may fall back to full build)
      expect(positions.has('first')).toBe(true);
    });
  });

  describe('Legacy Wikilink Support', () => {
    it('should use linkedNodeIds as parent when no parentId specified', () => {
      const nodes: NodeInfo[] = [
        { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        {
          id: 'child',
          position: { x: 0, y: 0 },
          size: { width: 80, height: 40 },
          linkedNodeIds: ['parent', 'other']
        }
      ];

      const positions = strategy.fullBuild(nodes);

      expect(positions.size).toBe(2);

      // Child should be below parent
      const parentY = positions.get('parent')!.y;
      const childY = positions.get('child')!.y;
      expect(childY).toBeGreaterThan(parentY);
    });

    it('should prefer parentId over linkedNodeIds', () => {
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

      const positions = strategy.fullBuild(nodes);

      expect(positions.size).toBe(3);

      // Child should be below actualParent, not linkedNode
      const actualParentY = positions.get('actualParent')!.y;
      const childY = positions.get('child')!.y;
      expect(childY).toBeGreaterThan(actualParentY);
    });
  });

  describe('WASM Instance Persistence', () => {
    it('should reuse same WASM instance across fullBuild and addNodes', () => {
      const initialNodes: NodeInfo[] = [
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      strategy.fullBuild(initialNodes);

      const newNode: NodeInfo = {
        id: 'node2',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 },
        parentId: 'node1'
      };

      // This should use partial_layout() on the same instance
      const positions = strategy.addNodes([newNode]);

      expect(positions.has('node1')).toBe(true);
      expect(positions.has('node2')).toBe(true);
    });

    it('should maintain state through multiple incremental updates', () => {
      strategy.fullBuild([
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ]);

      strategy.addNodes([
        { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
      ]);

      const positions = strategy.addNodes([
        { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
      ]);

      expect(positions.has('root')).toBe(true);
      expect(positions.has('child1')).toBe(true);
      expect(positions.has('child2')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle node with reference to non-existent parent', () => {
      const nodes: NodeInfo[] = [
        {
          id: 'orphan',
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
          parentId: 'non-existent'
        }
      ];

      const positions = strategy.fullBuild(nodes);

      // Should treat as orphan (parent to ghost)
      expect(positions.has('orphan')).toBe(true);
      expect(positions.size).toBe(1);
    });

    it('should handle self-referencing node', () => {
      const nodes: NodeInfo[] = [
        {
          id: 'self-ref',
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
          parentId: 'self-ref'
        }
      ];

      const positions = strategy.fullBuild(nodes);

      // Should treat as orphan (ignore self-reference)
      expect(positions.has('self-ref')).toBe(true);
    });

    it('should handle nodes with zero dimensions', () => {
      const nodes: NodeInfo[] = [
        { id: 'zero-width', position: { x: 0, y: 0 }, size: { width: 0, height: 50 } },
        { id: 'zero-height', position: { x: 0, y: 0 }, size: { width: 100, height: 0 } }
      ];

      const positions = strategy.fullBuild(nodes);

      expect(positions.has('zero-width')).toBe(true);
      expect(positions.has('zero-height')).toBe(true);
    });
  });

  describe('isEmpty() method', () => {
    it('should return true for new instance', () => {
      expect(strategy.isEmpty()).toBe(true);
    });

    it('should return false after fullBuild', () => {
      strategy.fullBuild([
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ]);
      expect(strategy.isEmpty()).toBe(false);
    });

    it('should return true after fullBuild with empty array', () => {
      strategy.fullBuild([]);
      expect(strategy.isEmpty()).toBe(true);
    });
  });

  describe('position() method (unified interface)', () => {
    it('should use fullBuild for initial layout', () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      const result = strategy.position({ nodes, newNodes: [] });

      expect(result.positions.has('node1')).toBe(true);
    });

    it('should use addNodes for incremental updates', () => {
      // Initial setup
      strategy.fullBuild([
        { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ]);

      // Incremental add via position()
      const newNode: NodeInfo = {
        id: 'child',
        position: { x: 0, y: 0 },
        size: { width: 80, height: 40 },
        parentId: 'root'
      };

      const result = strategy.position({ nodes: [], newNodes: [newNode] });

      expect(result.positions.has('root')).toBe(true);
      expect(result.positions.has('child')).toBe(true);
    });

    it('should handle both nodes and newNodes together on initial load', () => {
      const existingNodes: NodeInfo[] = [
        { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];
      const newNodes: NodeInfo[] = [
        { id: 'node2', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
      ];

      const result = strategy.position({ nodes: existingNodes, newNodes });

      expect(result.positions.has('node1')).toBe(true);
      expect(result.positions.has('node2')).toBe(true);
    });
  });
});
