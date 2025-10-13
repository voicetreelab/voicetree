/**
 * Test for TidyLayoutStrategy commit/delta lifecycle
 *
 * This test verifies that the "Layout → Refine → Commit → Clear" cycle works correctly
 * to maintain layout stability across fullBuild and incremental addNodes operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TidyLayoutStrategy, TreeOrientation } from '@/graph-core/graphviz/layout/TidyLayoutStrategy';
import type { NodeInfo, Position } from '@/graph-core/graphviz/layout/types';

describe('TidyLayoutStrategy commit lifecycle', () => {
  let strategy: TidyLayoutStrategy;

  beforeEach(() => {
    strategy = new TidyLayoutStrategy(TreeOrientation.Diagonal45);
  });

  /**
   * Helper to calculate Euclidean distance between two positions
   */
  function distance(p1: Position, p2: Position): number {
    return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
  }

  /**
   * Core test: Verify that adding a new node doesn't drastically move existing nodes
   *
   * Expected behavior:
   * 1. fullBuild creates a stable layout with physics relaxation
   * 2. Adding a new node should preserve existing node positions (within tolerance)
   * 3. Only the new node and its immediate affected neighbors should move significantly
   *
   * This test fails if the commit/clear cycle is not correctly implemented!
   */
  it('should preserve existing node positions when adding new node', async () => {
    // STEP 1: Create initial tree structure
    //   root
    //   ├── A
    //   └── B
    const initialNodes: NodeInfo[] = [
      {
        id: 'root',
        size: { width: 200, height: 100 },
        parentId: undefined,
        linkedNodeIds: []
      },
      {
        id: 'A',
        size: { width: 200, height: 100 },
        parentId: 'root',
        linkedNodeIds: ['root']
      },
      {
        id: 'B',
        size: { width: 200, height: 100 },
        parentId: 'root',
        linkedNodeIds: ['root']
      }
    ];

    // STEP 2: Do fullBuild
    const positionsAfterFullBuild = await strategy.fullBuild(initialNodes);

    console.log('Positions after fullBuild:');
    for (const [id, pos] of positionsAfterFullBuild) {
      console.log(`  ${id}: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
    }

    // Verify all nodes got positions
    expect(positionsAfterFullBuild.size).toBe(3);
    expect(positionsAfterFullBuild.has('root')).toBe(true);
    expect(positionsAfterFullBuild.has('A')).toBe(true);
    expect(positionsAfterFullBuild.has('B')).toBe(true);

    // STEP 3: Add a new node C as child of root
    //   root
    //   ├── A
    //   ├── B
    //   └── C (new)
    const newNode: NodeInfo = {
      id: 'C',
      size: { width: 200, height: 100 },
      parentId: 'root',
      linkedNodeIds: ['root']
    };

    const positionsAfterAdd = await strategy.addNodes([newNode]);

    console.log('Positions after addNodes:');
    for (const [id, pos] of positionsAfterAdd) {
      console.log(`  ${id}: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
    }

    // STEP 4: Verify existing nodes didn't move much
    // (Allow some movement due to physics, but should be < 50 pixels)
    const TOLERANCE = 50;

    // Note: addNodes returns ALL positions, not just the new ones
    // If it only returned the new node, we'd need to track separately
    const rootAfter = positionsAfterAdd.get('root');
    const aAfter = positionsAfterAdd.get('A');
    const bAfter = positionsAfterAdd.get('B');

    expect(rootAfter).toBeDefined();
    expect(aAfter).toBeDefined();
    expect(bAfter).toBeDefined();

    const rootBefore = positionsAfterFullBuild.get('root')!;
    const aBefore = positionsAfterFullBuild.get('A')!;
    const bBefore = positionsAfterFullBuild.get('B')!;

    const rootMovement = distance(rootBefore, rootAfter!);
    const aMovement = distance(aBefore, aAfter!);
    const bMovement = distance(bBefore, bAfter!);

    console.log('Movement after adding node C:');
    console.log(`  root: ${rootMovement.toFixed(1)} pixels`);
    console.log(`  A: ${aMovement.toFixed(1)} pixels`);
    console.log(`  B: ${bMovement.toFixed(1)} pixels`);

    // These assertions will FAIL if the commit/clear cycle is wrong!
    // Because the layout will restart from scratch (cold start)
    expect(rootMovement).toBeLessThan(TOLERANCE);
    expect(aMovement).toBeLessThan(TOLERANCE);
    expect(bMovement).toBeLessThan(TOLERANCE);

    // Verify new node was added
    expect(positionsAfterAdd.has('C')).toBe(true);
  });

  /**
   * Test that verifies the issue: without commit, layout is unstable
   * This test documents the bug that the commit/clear cycle fixes.
   */
  it('demonstrates the bug: layout changes completely without commit', async () => {
    // Same setup as above
    const initialNodes: NodeInfo[] = [
      {
        id: 'root',
        size: { width: 200, height: 100 },
        parentId: undefined,
        linkedNodeIds: []
      },
      {
        id: 'A',
        size: { width: 200, height: 100 },
        parentId: 'root',
        linkedNodeIds: ['root']
      }
    ];

    const pos1 = await strategy.fullBuild(initialNodes);

    // Add a node
    const newNode: NodeInfo = {
      id: 'B',
      size: { width: 200, height: 100 },
      parentId: 'root',
      linkedNodeIds: ['root']
    };

    const pos2 = await strategy.addNodes([newNode]);

    // Log for debugging
    console.log('Before add:', pos1.get('root'), pos1.get('A'));
    console.log('After add:', pos2.get('root'), pos2.get('A'));

    // The bug: if commit/clear is wrong, these will move > 100 pixels
    const rootMovement = distance(pos1.get('root')!, pos2.get('root')!);
    const aMovement = distance(pos1.get('A')!, pos2.get('A')!);

    console.log(`Bug check - root moved ${rootMovement.toFixed(1)}px, A moved ${aMovement.toFixed(1)}px`);

    // If movements are > 100, the bug is present
    if (rootMovement > 100 || aMovement > 100) {
      console.error('BUG DETECTED: Layout is unstable! Nodes moved too much.');
      console.error('This indicates the commit/clear cycle is not working correctly.');
    }
  });
});
