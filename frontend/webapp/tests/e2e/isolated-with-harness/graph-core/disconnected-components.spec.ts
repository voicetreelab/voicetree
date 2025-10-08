import { test, expect } from '@playwright/test';

test.describe('Disconnected Components - Layout', () => {
  test('should handle orphan nodes and isolated components without overlaps', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/incremental-layout-harness.html');
    await page.waitForSelector('#root canvas', { timeout: 5000 });

    const result = await page.evaluate(() => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      window.cy.elements().remove();

      // Create test structure:
      // - 3 orphan nodes (no parents, no children)
      // - 2 isolated 3-node trees (each with 1 parent + 2 children)
      // Total: 9 nodes

      const nodes = [
        // Orphans
        { id: 'orphan-1', label: 'Orphan 1', parentId: null, linkedNodeIds: [] },
        { id: 'orphan-2', label: 'Orphan 2', parentId: null, linkedNodeIds: [] },
        { id: 'orphan-3', label: 'Orphan 3', parentId: null, linkedNodeIds: [] },

        // Tree 1: root-1 -> child-1a, child-1b
        { id: 'root-1', label: 'Root 1', parentId: null, linkedNodeIds: [] },
        { id: 'child-1a', label: 'Child 1A', parentId: 'root-1', linkedNodeIds: ['root-1'] },
        { id: 'child-1b', label: 'Child 1B', parentId: 'root-1', linkedNodeIds: ['root-1'] },

        // Tree 2: root-2 -> child-2a, child-2b
        { id: 'root-2', label: 'Root 2', parentId: null, linkedNodeIds: [] },
        { id: 'child-2a', label: 'Child 2A', parentId: 'root-2', linkedNodeIds: ['root-2'] },
        { id: 'child-2b', label: 'Child 2B', parentId: 'root-2', linkedNodeIds: ['root-2'] },
      ];

      // Add nodes to cytoscape
      for (const nodeData of nodes) {
        window.cy.add({
          group: 'nodes',
          data: nodeData
        });

        // Add edges
        if (nodeData.linkedNodeIds && nodeData.linkedNodeIds.length > 0) {
          for (const targetId of nodeData.linkedNodeIds) {
            window.cy.add({
              group: 'edges',
              data: {
                id: `${nodeData.id}-${targetId}`,
                source: nodeData.id,
                target: targetId
              }
            });
          }
        }
      }

      // Layout all nodes at once (bulk layout)
      window.layoutManager.applyLayout(window.cy, []);

      // Get all positions
      const positions = nodes.map(n => ({
        id: n.id,
        x: window.cy.$id(n.id).position().x,
        y: window.cy.$id(n.id).position().y
      }));

      // Check for overlaps
      const cyNodes = window.cy.nodes();
      let overlapCount = 0;
      let severeOverlaps = 0;
      const minDistance = 10;
      const severeThreshold = 5;

      for (let i = 0; i < cyNodes.length; i++) {
        const n1 = cyNodes[i];
        const p1 = n1.position();
        const bb1 = n1.boundingBox({ includeLabels: false });
        const r1 = Math.max(bb1.w, bb1.h) / 2;

        for (let j = i + 1; j < cyNodes.length; j++) {
          const n2 = cyNodes[j];
          const p2 = n2.position();
          const bb2 = n2.boundingBox({ includeLabels: false });
          const r2 = Math.max(bb2.w, bb2.h) / 2;

          const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          const touchDistance = r1 + r2;

          if (distance < touchDistance + minDistance) {
            overlapCount++;
            if (distance < touchDistance + severeThreshold) {
              severeOverlaps++;
            }
          }
        }
      }

      return {
        positions,
        overlapCount,
        severeOverlaps
      };
    });

    console.log('Positions:', result.positions);
    console.log(`Overlaps: ${result.overlapCount}, Severe: ${result.severeOverlaps}`);

    // Check all positions are defined and not NaN
    for (const pos of result.positions) {
      expect(pos.x).not.toBeNaN();
      expect(pos.y).not.toBeNaN();
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
    }

    // No severe overlaps allowed
    expect(result.severeOverlaps).toBe(0);

    // No minor overlaps either for such a simple graph
    expect(result.overlapCount).toBe(0);

    // Check that orphans are spread out horizontally (not all at x=0)
    const orphanPositions = result.positions.filter(p => p.id.startsWith('orphan-'));
    const uniqueX = new Set(orphanPositions.map(p => Math.round(p.x)));
    expect(uniqueX.size).toBe(3); // All 3 orphans should have different X positions

    // Check that the two trees are separated
    const tree1Positions = result.positions.filter(p => p.id.startsWith('root-1') || p.id.startsWith('child-1'));
    const tree2Positions = result.positions.filter(p => p.id.startsWith('root-2') || p.id.startsWith('child-2'));

    const tree1MinX = Math.min(...tree1Positions.map(p => p.x));
    const tree1MaxX = Math.max(...tree1Positions.map(p => p.x));
    const tree2MinX = Math.min(...tree2Positions.map(p => p.x));
    const tree2MaxX = Math.max(...tree2Positions.map(p => p.x));

    // Trees should not overlap horizontally
    const treesOverlap = (tree1MinX <= tree2MaxX && tree2MinX <= tree1MaxX);
    expect(treesOverlap).toBe(false);

    console.log('✓ All disconnected components properly laid out');
  });
});
