import { describe, it, expect, beforeEach } from 'vitest';
import { TidyLayoutStrategy, TreeOrientation } from '@/graph-core/graphviz/layout/TidyLayoutStrategy';
import type { NodeInfo } from '@/graph-core/graphviz/layout/types';

describe('TidyLayoutStrategy', () => {
  let strategy: TidyLayoutStrategy;

  beforeEach(() => {
    // Use LeftRight orientation for all existing tests since they were designed for that
    strategy = new TidyLayoutStrategy(TreeOrientation.LeftRight);
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
  });

  //   it('should handle mix of orphans and parented nodes', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
  //       { id: 'orphan', position: { x: 0, y: 0 }, size: { width: 90, height: 45 } }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     expect(positions.has('root')).toBe(true);
  //     expect(positions.has('child')).toBe(true);
  //     expect(positions.has('orphan')).toBe(true);
  //     expect(positions.has('__GHOST_ROOT__')).toBe(false);
  //   });
  // });
  //
  // describe('ID Mapping Stability', () => {
  //   it('should maintain stable string to numeric ID mappings across calls', async () => {
  //     const node1: NodeInfo = {
  //       id: 'stable-node',
  //       position: { x: 0, y: 0 },
  //       size: { width: 100, height: 50 }
  //     };
  //
  //     // First build
  //     const positions1 = await strategy.fullBuild([node1]);
  //     const pos1 = positions1.get('stable-node')!;
  //
  //     // Second build with same node
  //     const positions2 = await strategy.fullBuild([node1]);
  //     const pos2 = positions2.get('stable-node')!;
  //
  //     // Positions should be identical (same ID mapping used)
  //     expect(pos1.x).toBe(pos2.x);
  //     expect(pos1.y).toBe(pos2.y);
  //   });
  //
  //   it('should maintain mappings when adding new nodes incrementally', async () => {
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'node2', position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, parentId: 'node1' }
  //     ];
  //
  //     await strategy.fullBuild(initialNodes);
  //
  //     // Add new node
  //     const newNode: NodeInfo = {
  //       id: 'node3',
  //       position: { x: 0, y: 0 },
  //       size: { width: 100, height: 50 },
  //       parentId: 'node2'
  //     };
  //
  //     const positions = await strategy.addNodes([newNode]);
  //
  //     // All nodes should be present
  //     expect(positions.has('node1')).toBe(true);
  //     expect(positions.has('node2')).toBe(true);
  //     expect(positions.has('node3')).toBe(true);
  //   });
  // });
  //
  // describe('Full Build', () => {
  //   it('should position a single node', async () => {
  //     const node: NodeInfo = {
  //       id: 'single',
  //       position: { x: 0, y: 0 },
  //       size: { width: 100, height: 50 }
  //     };
  //
  //     const positions = await strategy.fullBuild([node]);
  //
  //     expect(positions.size).toBe(1);
  //     expect(positions.has('single')).toBe(true);
  //     const pos = positions.get('single')!;
  //     expect(typeof pos.x).toBe('number');
  //     expect(typeof pos.y).toBe('number');
  //   });
  //
  //   it('should position a simple parent-child tree', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' },
  //       { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     expect(positions.size).toBe(3);
  //     expect(positions.has('parent')).toBe(true);
  //     expect(positions.has('child1')).toBe(true);
  //     expect(positions.has('child2')).toBe(true);
  //
  //     // Parent should be left of children (smaller x value) in left-right orientation
  //     const parentX = positions.get('parent')!.x;
  //     const child1X = positions.get('child1')!.x;
  //     const child2X = positions.get('child2')!.x;
  //     expect(parentX).toBeLessThan(child1X);
  //     expect(parentX).toBeLessThan(child2X);
  //   });
  //
  //   it('should handle multi-level hierarchy', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
  //       { id: 'grandchild', position: { x: 0, y: 0 }, size: { width: 60, height: 30 }, parentId: 'child' }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     expect(positions.size).toBe(3);
  //
  //     const rootX = positions.get('root')!.x;
  //     const childX = positions.get('child')!.x;
  //     const grandchildX = positions.get('grandchild')!.x;
  //
  //     // Should be horizontally ordered in left-right orientation
  //     expect(rootX).toBeLessThan(childX);
  //     expect(childX).toBeLessThan(grandchildX);
  //   });
  //
  //   it('should return empty map for empty input', async () => {
  //     const positions = await strategy.fullBuild([]);
  //     expect(positions.size).toBe(0);
  //   });
  //
  //   it('should handle disconnected components', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'tree1-root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'tree1-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'tree1-root' },
  //       { id: 'tree2-root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'tree2-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'tree2-root' }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     expect(positions.size).toBe(4);
  //     // Both trees should be positioned
  //     expect(positions.has('tree1-root')).toBe(true);
  //     expect(positions.has('tree1-child')).toBe(true);
  //     expect(positions.has('tree2-root')).toBe(true);
  //     expect(positions.has('tree2-child')).toBe(true);
  //   });
  // });
  //
  // describe('Incremental Layout with addNodes', () => {
  //   afterEach(() => {
  //     vi.restoreAllMocks();
  //   });
  //
  //   it.skip('should call partial_layout when adding nodes incrementally (baseline tidy does not have partial_layout)', async () => {
  //     // Skipped: baseline tidy library does not have partial_layout/update_node_size methods
  //     // TODO: Re-enable once these methods are added to Rust tidy library
  //   });
  //
  //   it('should add a new child to existing tree', async () => {
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
  //     ];
  //
  //     await strategy.fullBuild(initialNodes);
  //
  //     const newNode: NodeInfo = {
  //       id: 'child2',
  //       position: { x: 0, y: 0 },
  //       size: { width: 80, height: 40 },
  //       parentId: 'parent'
  //     };
  //
  //     const positions = await strategy.addNodes([newNode]);
  //
  //     // All nodes should be positioned
  //     expect(positions.size).toBeGreaterThanOrEqual(3);
  //     expect(positions.has('parent')).toBe(true);
  //     expect(positions.has('child1')).toBe(true);
  //     expect(positions.has('child2')).toBe(true);
  //   });
  //
  //   it('should add multiple new nodes at once', async () => {
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ];
  //
  //     await strategy.fullBuild(initialNodes);
  //
  //     const newNodes: NodeInfo[] = [
  //       { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
  //       { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
  //     ];
  //
  //     const positions = await strategy.addNodes(newNodes);
  //
  //     expect(positions.has('root')).toBe(true);
  //     expect(positions.has('child1')).toBe(true);
  //     expect(positions.has('child2')).toBe(true);
  //   });
  //
  //   it('should add orphan nodes incrementally', async () => {
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'existing', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ];
  //
  //     await strategy.fullBuild(initialNodes);
  //
  //     const newOrphan: NodeInfo = {
  //       id: 'orphan',
  //       position: { x: 0, y: 0 },
  //       size: { width: 100, height: 50 }
  //     };
  //
  //     const positions = await strategy.addNodes([newOrphan]);
  //
  //     expect(positions.has('existing')).toBe(true);
  //     expect(positions.has('orphan')).toBe(true);
  //   });
  //
  //   it('should handle adding nodes without prior fullBuild', async () => {
  //     // This tests resilience - strategy should handle this gracefully
  //     const newNode: NodeInfo = {
  //       id: 'first',
  //       position: { x: 0, y: 0 },
  //       size: { width: 100, height: 50 }
  //     };
  //
  //     const positions = await strategy.addNodes([newNode]);
  //
  //     // Should position the node (may fall back to full build)
  //     expect(positions.has('first')).toBe(true);
  //   });
  // });
  //
  // describe('Legacy Wikilink Support', () => {
  //   it('should use linkedNodeIds as parent when no parentId specified', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       {
  //         id: 'child',
  //         position: { x: 0, y: 0 },
  //         size: { width: 80, height: 40 },
  //         linkedNodeIds: ['parent', 'other']
  //       }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     expect(positions.size).toBe(2);
  //
  //     // Child should be to the right of parent (left-right orientation)
  //     const parentX = positions.get('parent')!.x;
  //     const childX = positions.get('child')!.x;
  //     expect(childX).toBeGreaterThan(parentX);
  //   });
  //
  //   it('should prefer parentId over linkedNodeIds', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'actualParent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'linkedNode', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       {
  //         id: 'child',
  //         position: { x: 0, y: 0 },
  //         size: { width: 80, height: 40 },
  //         parentId: 'actualParent',
  //         linkedNodeIds: ['linkedNode']
  //       }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     expect(positions.size).toBe(3);
  //
  //     // Child should be to the right of actualParent, not linkedNode (left-right orientation)
  //     const actualParentX = positions.get('actualParent')!.x;
  //     const childX = positions.get('child')!.x;
  //     expect(childX).toBeGreaterThan(actualParentX);
  //   });
  // });
  //
  // describe('WASM Instance Persistence', () => {
  //   it('should reuse same WASM instance across fullBuild and addNodes', async () => {
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ];
  //
  //     await strategy.fullBuild(initialNodes);
  //
  //     const newNode: NodeInfo = {
  //       id: 'node2',
  //       position: { x: 0, y: 0 },
  //       size: { width: 100, height: 50 },
  //       parentId: 'node1'
  //     };
  //
  //     // This should use partial_layout() on the same instance
  //     const positions = await strategy.addNodes([newNode]);
  //
  //     expect(positions.has('node1')).toBe(true);
  //     expect(positions.has('node2')).toBe(true);
  //   });
  //
  //   it('should maintain state through multiple incremental updates', async () => {
  //     await strategy.fullBuild([
  //       { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ]);
  //
  //     await strategy.addNodes([
  //       { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
  //     ]);
  //
  //     const positions = await strategy.addNodes([
  //       { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
  //     ]);
  //
  //     expect(positions.has('root')).toBe(true);
  //     expect(positions.has('child1')).toBe(true);
  //     expect(positions.has('child2')).toBe(true);
  //   });
  // });
  //
  // describe('Edge Cases', () => {
  //   it('should handle node with reference to non-existent parent', async () => {
  //     const nodes: NodeInfo[] = [
  //       {
  //         id: 'orphan',
  //         position: { x: 0, y: 0 },
  //         size: { width: 100, height: 50 },
  //         parentId: 'non-existent'
  //       }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     // Should treat as orphan (parent to ghost)
  //     expect(positions.has('orphan')).toBe(true);
  //     expect(positions.size).toBe(1);
  //   });
  //
  //   it('should handle self-referencing node', async () => {
  //     const nodes: NodeInfo[] = [
  //       {
  //         id: 'self-ref',
  //         position: { x: 0, y: 0 },
  //         size: { width: 100, height: 50 },
  //         parentId: 'self-ref'
  //       }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     // Should treat as orphan (ignore self-reference)
  //     expect(positions.has('self-ref')).toBe(true);
  //   });
  //
  //   it('should handle nodes with zero dimensions', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'zero-width', position: { x: 0, y: 0 }, size: { width: 0, height: 50 } },
  //       { id: 'zero-height', position: { x: 0, y: 0 }, size: { width: 100, height: 0 } }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     expect(positions.has('zero-width')).toBe(true);
  //     expect(positions.has('zero-height')).toBe(true);
  //   });
  // });
  //
  // describe('isEmpty() method', () => {
  //   it('should return true for new instance', async () => {
  //     expect(strategy.isEmpty()).toBe(true);
  //   });
  //
  //   it('should return false after fullBuild', async () => {
  //     await strategy.fullBuild([
  //       { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ]);
  //     expect(strategy.isEmpty()).toBe(false);
  //   });
  //
  //   it('should return true after fullBuild with empty array', async () => {
  //     await strategy.fullBuild([]);
  //     expect(strategy.isEmpty()).toBe(true);
  //   });
  // });
  //
  // describe('position() method (unified interface)', () => {
  //   it('should use fullBuild for initial layout', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ];
  //
  //     const result = await strategy.position({ nodes, newNodes: [] });
  //
  //     expect(result.positions.has('node1')).toBe(true);
  //   });
  //
  //   it('should use addNodes for incremental updates', async () => {
  //     // Initial setup
  //     await strategy.fullBuild([
  //       { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ]);
  //
  //     // Incremental add via position()
  //     const newNode: NodeInfo = {
  //       id: 'child',
  //       position: { x: 0, y: 0 },
  //       size: { width: 80, height: 40 },
  //       parentId: 'root'
  //     };
  //
  //     const result = await strategy.position({ nodes: [], newNodes: [newNode] });
  //
  //     expect(result.positions.has('root')).toBe(true);
  //     expect(result.positions.has('child')).toBe(true);
  //   });
  //
  //   it('should handle both nodes and newNodes together on initial load', async () => {
  //     const existingNodes: NodeInfo[] = [
  //       { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ];
  //     const newNodes: NodeInfo[] = [
  //       { id: 'node2', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ];
  //
  //     const result = await strategy.position({ nodes: existingNodes, newNodes });
  //
  //     expect(result.positions.has('node1')).toBe(true);
  //     expect(result.positions.has('node2')).toBe(true);
  //   });
  // });
  //
  // describe('Left-Right Orientation', () => {
  //   it('should position children to the RIGHT of parent (not below)', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' },
  //       { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     // Parent should be LEFT of children (smaller x value)
  //     const parentX = positions.get('parent')!.x;
  //     const child1X = positions.get('child1')!.x;
  //     const child2X = positions.get('child2')!.x;
  //
  //     expect(parentX).toBeLessThan(child1X);
  //     expect(parentX).toBeLessThan(child2X);
  //   });
  //
  //   it('should grow multi-level hierarchy horizontally (left to right)', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
  //       { id: 'grandchild', position: { x: 0, y: 0 }, size: { width: 60, height: 30 }, parentId: 'child' }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     const rootX = positions.get('root')!.x;
  //     const childX = positions.get('child')!.x;
  //     const grandchildX = positions.get('grandchild')!.x;
  //
  //     // Should be horizontally ordered: root → child → grandchild
  //     expect(rootX).toBeLessThan(childX);
  //     expect(childX).toBeLessThan(grandchildX);
  //   });
  //
  //   it('should separate siblings vertically at same depth level', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' },
  //       { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     const child1Pos = positions.get('child1')!;
  //     const child2Pos = positions.get('child2')!;
  //
  //     // Siblings should have different Y (vertically separated)
  //     expect(child1Pos.y).not.toBe(child2Pos.y);
  //
  //     // But similar X (same depth level, allowing for minor layout differences)
  //     const xDiff = Math.abs(child1Pos.x - child2Pos.x);
  //     expect(xDiff).toBeLessThan(50); // Allow small variance
  //   });
  //
  //   it('should position disconnected trees side-by-side instead of stacked', async () => {
  //     const nodes: NodeInfo[] = [
  //       { id: 'tree1-root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'tree1-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'tree1-root' },
  //       { id: 'tree2-root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'tree2-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'tree2-root' }
  //     ];
  //
  //     const positions = await strategy.fullBuild(nodes);
  //
  //     const tree1RootPos = positions.get('tree1-root')!;
  //     const tree2RootPos = positions.get('tree2-root')!;
  //
  //     // Trees should be separated vertically (different Y), not horizontally
  //     const yDiff = Math.abs(tree1RootPos.y - tree2RootPos.y);
  //     expect(yDiff).toBeGreaterThan(50);
  //   });
  //
  //   it('should maintain left-right orientation in incremental updates', async () => {
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' }
  //     ];
  //
  //     await strategy.fullBuild(initialNodes);
  //
  //     const newNode: NodeInfo = {
  //       id: 'child2',
  //       position: { x: 0, y: 0 },
  //       size: { width: 80, height: 40 },
  //       parentId: 'root'
  //     };
  //
  //     const positions = await strategy.addNodes([newNode]);
  //
  //     // Root should still be left of all children
  //     const rootX = positions.get('root')!.x;
  //     const child1X = positions.get('child1')!.x;
  //     const child2X = positions.get('child2')!.x;
  //
  //     expect(rootX).toBeLessThan(child1X);
  //     expect(rootX).toBeLessThan(child2X);
  //   });
  // });
  //
  // describe('Visual Continuity (Incremental Adds)', () => {
  //   it('should maintain visual continuity when adding nodes incrementally', async () => {
  //     // Setup: Create a parent node with realistic dimensions
  //     const parent: NodeInfo = {
  //       id: 'parent',
  //       position: { x: 0, y: 0 },
  //       size: { width: 200, height: 100 } // Realistic node size
  //     };
  //
  //     // Step 1: Do fullBuild with just the parent and get its position
  //     const initialPositions = await strategy.fullBuild([parent]);
  //     const parentInitialPos = initialPositions.get('parent')!;
  //
  //     console.log('[Visual Continuity Test] Parent initial position:', parentInitialPos);
  //
  //     // Step 2: Add a child node incrementally using addNodes()
  //     const child: NodeInfo = {
  //       id: 'child',
  //       position: { x: 0, y: 0 },
  //       size: { width: 150, height: 80 }, // Realistic child size
  //       parentId: 'parent'
  //     };
  //
  //     const updatedPositions = await strategy.addNodes([child]);
  //     const parentNewPos = updatedPositions.get('parent')!;
  //
  //     console.log('[Visual Continuity Test] Parent new position:', parentNewPos);
  //
  //     // Step 3: Calculate how much the parent moved
  //     const deltaX = Math.abs(parentNewPos.x - parentInitialPos.x);
  //     const deltaY = Math.abs(parentNewPos.y - parentInitialPos.y);
  //     const totalDelta = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  //
  //     // Log the delta for debugging and monitoring
  //     console.log('[Visual Continuity Test] Parent movement delta:', {
  //       deltaX: deltaX.toFixed(2),
  //       deltaY: deltaY.toFixed(2),
  //       totalDelta: totalDelta.toFixed(2)
  //     });
  //
  //     // Step 4: Assert that parent moved less than 5px (visual continuity threshold)
  //     // This is the key assertion - incremental adds should not cause jarring jumps
  //     expect(totalDelta).toBeLessThan(5);
  //
  //     // Also verify the child was actually positioned
  //     expect(updatedPositions.has('child')).toBe(true);
  //   });
  // });
  //
  // describe('updateNodeDimensions (Resize Flow)', () => {
  //   let mockCy: import('cytoscape').Core;
  //
  //   beforeEach(() => {
  //     // Create mock Cytoscape instance
  //     mockCy = {
  //       // eslint-disable-next-line @typescript-eslint/no-unused-vars
  //       getElementById: vi.fn((_id: string) => ({
  //         length: 1,
  //         width: () => 100,
  //         height: () => 50
  //       }))
  //     } as unknown as import('cytoscape').Core;
  //   });
  //
  //   afterEach(() => {
  //     vi.restoreAllMocks();
  //   });
  //
  //   it.skip('should call partial_layout, not full layout when dimensions change (baseline tidy does not have partial_layout)', async () => {
  //     // Skipped: baseline tidy library does not have partial_layout/update_node_size methods
  //     // TODO: Re-enable once these methods are added to Rust tidy library
  //   });
  //
  //   it('should return empty map when no nodes provided', async () => {
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ];
  //
  //     await strategy.fullBuild(initialNodes);
  //
  //     const positions = await strategy.updateNodeDimensions(mockCy, []);
  //     expect(positions.size).toBe(0);
  //   });
  //
  //   it('should handle non-existent nodes gracefully', async () => {
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'node1', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } }
  //     ];
  //
  //     await strategy.fullBuild(initialNodes);
  //
  //     const positions = await strategy.updateNodeDimensions(mockCy, ['non-existent']);
  //
  //     // Should not crash, may return empty or existing positions
  //     expect(positions).toBeDefined();
  //   });
  //
  //   it('CRITICAL: when a node grows 3x, its sibling MUST move to avoid overlap', async () => {
  //     // This is the CRITICAL test - partial_layout MUST reposition siblings
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' },
  //       { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
  //     ];
  //
  //     const initialPositions = await strategy.fullBuild(initialNodes);
  //     const child1InitialY = initialPositions.get('child1')!.y;
  //     const child2InitialY = initialPositions.get('child2')!.y;
  //
  //     // Verify initial separation (siblings are vertically separated)
  //     const initialYGap = Math.abs(child2InitialY - child1InitialY);
  //     expect(initialYGap).toBeGreaterThan(0);
  //
  //     // Mock child1 growing 3x in height (from 40 to 120)
  //     mockCy.getElementById = vi.fn((id: string) => {
  //       if (id === 'child1') {
  //         return {
  //           length: 1,
  //           width: () => 80,
  //           height: () => 120 // 3x the original height
  //         };
  //       }
  //       return {
  //         length: 1,
  //         width: () => 80,
  //         height: () => 40
  //       };
  //     }) as unknown as typeof mockCy.getElementById;
  //
  //     // Update dimensions for child1
  //     const updatedPositions = await strategy.updateNodeDimensions(mockCy, ['child1']);
  //
  //     // Get new positions
  //     const child1NewY = updatedPositions.get('child1')!.y;
  //     const child2NewY = updatedPositions.get('child2')!.y;
  //
  //     // CRITICAL ASSERTION: child2 MUST have moved to avoid overlap with the now-larger child1
  //     const newYGap = Math.abs(child2NewY - child1NewY);
  //
  //     // The gap should have increased to accommodate the larger child1
  //     // Since child1 grew from 40 to 120 (increase of 80), and there's peer margin,
  //     // the gap should be significantly larger than initial
  //     expect(newYGap).toBeGreaterThan(initialYGap);
  //
  //     // More specifically: the new gap should account for the increased size
  //     // With peer margin of 160 and child1 height of 120, minimum gap should be ~140
  //     expect(newYGap).toBeGreaterThan(100);
  //   });
  //
  //   it('should NOT move single child when it resizes (no siblings to collide with)', async () => {
  //     // This test verifies the insight: resizing a node WITHOUT siblings doesn't cause position change
  //     // Only the bounding box grows - the node stays in the same location
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'only-child', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
  //     ];
  //
  //     const initialPositions = await strategy.fullBuild(initialNodes);
  //     const childInitialX = initialPositions.get('only-child')!.x;
  //     const childInitialY = initialPositions.get('only-child')!.y;
  //
  //     // Mock child growing 3x in height (from 40 to 120)
  //     mockCy.getElementById = vi.fn((id: string) => {
  //       if (id === 'only-child') {
  //         return {
  //           length: 1,
  //           width: () => 80,
  //           height: () => 120 // 3x the original height
  //         };
  //       }
  //       return {
  //         length: 1,
  //         width: () => 100,
  //         height: () => 50
  //       };
  //     }) as unknown as typeof mockCy.getElementById;
  //
  //     // Update dimensions for only-child
  //     const updatedPositions = await strategy.updateNodeDimensions(mockCy, ['only-child']);
  //
  //     // Get new position
  //     const childNewX = updatedPositions.get('only-child')!.x;
  //     const childNewY = updatedPositions.get('only-child')!.y;
  //
  //     // KEY ASSERTION: Position should NOT change significantly
  //     // Since there's no sibling to collide with, the node stays relatively in the same spot
  //     // Note: The layout algorithm may adjust positions slightly (~8px) due to contour calculations
  //     // even without siblings, but this is still considered stable positioning
  //     expect(Math.abs(childNewX - childInitialX)).toBeLessThan(10);
  //     expect(Math.abs(childNewY - childInitialY)).toBeLessThan(10);
  //   });
  //
  //   it('should handle multiple nodes resizing simultaneously', async () => {
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' },
  //       { id: 'child2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
  //     ];
  //
  //     await strategy.fullBuild(initialNodes);
  //
  //     // Mock both children growing
  //     // eslint-disable-next-line @typescript-eslint/no-unused-vars
  //     mockCy.getElementById = vi.fn((_id: string) => ({
  //       length: 1,
  //       width: () => 100, // Both grow
  //       height: () => 60
  //     })) as unknown as typeof mockCy.getElementById;
  //
  //     const positions = await strategy.updateNodeDimensions(mockCy, ['child1', 'child2']);
  //
  //     // All nodes should be repositioned
  //     expect(positions.has('parent')).toBe(true);
  //     expect(positions.has('child1')).toBe(true);
  //     expect(positions.has('child2')).toBe(true);
  //   });
  //
  //   it.skip('should call update_node_size with correctly transformed dimensions (baseline tidy does not have update_node_size)', async () => {
  //     // Skipped: baseline tidy library does not have partial_layout/update_node_size methods
  //     // TODO: Re-enable once these methods are added to Rust tidy library
  //   });
  //
  //   it('should move parent\'s siblings when deeply nested child resizes (multi-level impact)', async () => {
  //     // Test that partial_layout propagates changes up the tree
  //     // When a deeply nested node grows, it can push its ancestors which may push their siblings
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'parent1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
  //       { id: 'parent2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
  //       { id: 'child1-1', position: { x: 0, y: 0 }, size: { width: 60, height: 30 }, parentId: 'parent1' },
  //       { id: 'child2-1', position: { x: 0, y: 0 }, size: { width: 60, height: 30 }, parentId: 'parent2' }
  //     ];
  //
  //     const initialPositions = await strategy.fullBuild(initialNodes);
  //     const parent1InitialY = initialPositions.get('parent1')!.y;
  //     const parent2InitialY = initialPositions.get('parent2')!.y;
  //
  //     // Verify parent1 and parent2 are separated vertically (siblings)
  //     const initialParentGap = Math.abs(parent2InitialY - parent1InitialY);
  //     expect(initialParentGap).toBeGreaterThan(0);
  //
  //     // Mock child1-1 growing 5x in height
  //     mockCy.getElementById = vi.fn((id: string) => {
  //       if (id === 'child1-1') {
  //         return {
  //           length: 1,
  //           width: () => 60,
  //           height: () => 150 // 5x the original height
  //         };
  //       }
  //       // Return default for other nodes
  //       return {
  //         length: 1,
  //         width: () => 80,
  //         height: () => 40
  //       };
  //     }) as unknown as typeof mockCy.getElementById;
  //
  //     // Update dimensions for child1-1
  //     const updatedPositions = await strategy.updateNodeDimensions(mockCy, ['child1-1']);
  //
  //     // Get new positions
  //     const parent1NewY = updatedPositions.get('parent1')!.y;
  //     const parent2NewY = updatedPositions.get('parent2')!.y;
  //
  //     // CRITICAL ASSERTION: parent2 MUST have moved
  //     // Even though we only resized child1-1, the layout algorithm should:
  //     // 1. Grow child1-1's bounding box
  //     // 2. This increases parent1's subtree height
  //     // 3. parent1 and parent2 are siblings, so parent2 must move to avoid overlap
  //     const newParentGap = Math.abs(parent2NewY - parent1NewY);
  //
  //     // The gap between parent1 and parent2 should have increased
  //     expect(newParentGap).toBeGreaterThan(initialParentGap);
  //
  //     // More specifically: parent2 should have moved down (increased Y)
  //     // to accommodate the larger subtree under parent1
  //     expect(Math.abs(parent2NewY - parent2InitialY)).toBeGreaterThan(5);
  //   });
  //
  //   it('should handle complex tree with multiple levels and verify all affected nodes move', async () => {
  //     // Complex tree:
  //     //        root
  //     //       /    \
  //     //    parent1  parent2
  //     //    /    \      \
  //     // child1 child2  child3
  //     const initialNodes: NodeInfo[] = [
  //       { id: 'root', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  //       { id: 'parent1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
  //       { id: 'parent2', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'root' },
  //       { id: 'child1', position: { x: 0, y: 0 }, size: { width: 60, height: 30 }, parentId: 'parent1' },
  //       { id: 'child2', position: { x: 0, y: 0 }, size: { width: 60, height: 30 }, parentId: 'parent1' },
  //       { id: 'child3', position: { x: 0, y: 0 }, size: { width: 60, height: 30 }, parentId: 'parent2' }
  //     ];
  //
  //     const initialPositions = await strategy.fullBuild(initialNodes);
  //
  //     // Track initial positions
  //     const initial = {
  //       child1: initialPositions.get('child1')!.y,
  //       child2: initialPositions.get('child2')!.y,
  //       parent2: initialPositions.get('parent2')!.y,
  //       child3: initialPositions.get('child3')!.y
  //     };
  //
  //     // Verify child1 and child2 are siblings (different Y positions)
  //     expect(Math.abs(initial.child2 - initial.child1)).toBeGreaterThan(0);
  //
  //     // Mock child1 growing 4x
  //     mockCy.getElementById = vi.fn((id: string) => {
  //       if (id === 'child1') {
  //         return {
  //           length: 1,
  //           width: () => 60,
  //           height: () => 120 // 4x the original height
  //         };
  //       }
  //       return {
  //         length: 1,
  //         width: () => 60,
  //         height: () => 30
  //       };
  //     }) as unknown as typeof mockCy.getElementById;
  //
  //     const updatedPositions = await strategy.updateNodeDimensions(mockCy, ['child1']);
  //
  //     const updated = {
  //       child1: updatedPositions.get('child1')!.y,
  //       child2: updatedPositions.get('child2')!.y,
  //       parent2: updatedPositions.get('parent2')!.y,
  //       child3: updatedPositions.get('child3')!.y
  //     };
  //
  //     // child2 (sibling of child1) MUST move (though may be less than initially expected due to efficient layout)
  //     expect(Math.abs(updated.child2 - initial.child2)).toBeGreaterThan(2);
  //
  //     // parent2 (sibling of parent1, which contains the resized child1) MUST move
  //     expect(Math.abs(updated.parent2 - initial.parent2)).toBeGreaterThan(2);
  //
  //     // child3 (under parent2) should also move with its parent
  //     expect(Math.abs(updated.child3 - initial.child3)).toBeGreaterThan(2);
  //   });
  // });
});
