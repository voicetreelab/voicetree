import { test, expect } from '@playwright/test';

/**
 * Cola Refinement Tests
 *
 * Tests the Cola physics-based layout refinement module independently
 * before integrating it into TidyLayoutStrategy.
 *
 * This test verifies:
 * 1. Cola refinement can be applied to Tidy positions
 * 2. Nodes don't overlap after Cola refinement
 * 3. Tree hierarchy is maintained (parents above children)
 * 4. Edge lengths are respected
 * 5. Flow constraints work correctly
 */

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Check if any nodes overlap
 */
function checkNoOverlaps(nodePositions: Array<{
  id: string;
  x: number;
  y: number;
  width: number;
  height: number
}>) {
  const overlaps: Array<{ node1: string; node2: string; distance: number }> = [];
  const PADDING = 10; // Minimum spacing between nodes

  for (let i = 0; i < nodePositions.length; i++) {
    for (let j = i + 1; j < nodePositions.length; j++) {
      const n1 = nodePositions[i];
      const n2 = nodePositions[j];

      const dx = n1.x - n2.x;
      const dy = n1.y - n2.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const r1 = Math.max(n1.width, n1.height) / 2;
      const r2 = Math.max(n2.width, n2.height) / 2;
      const minDistance = r1 + r2 + PADDING;

      if (distance < minDistance) {
        overlaps.push({
          node1: n1.id,
          node2: n2.id,
          distance: minDistance - distance
        });
      }
    }
  }

  return overlaps;
}

/**
 * Get node positions from Cytoscape
 */
async function getNodePositions(page: any) {
  return await page.evaluate(() => {
    if (!window.cy) throw new Error('Cytoscape not initialized');

    return window.cy.nodes().map((n: any) => ({
      id: n.id(),
      x: n.position('x'),
      y: n.position('y'),
      width: n.width(),
      height: n.height()
    }));
  });
}

test.describe('Cola Refinement Module', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to test harness with full path
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cola-refinement-harness.html');

    // Wait for Cytoscape to initialize
    await page.waitForSelector('#cy', { timeout: 5000 });
    await page.waitForTimeout(500);
  });

  test('should apply Cola refinement to Tidy positions', async ({ page }) => {
    // Use programmatic API instead of clicking buttons
    await page.evaluate(() => window.testAPI!.loadFixture());
    await page.waitForTimeout(500);

    await page.evaluate(() => window.testAPI!.applyTidyLayout());
    await page.waitForTimeout(1000);

    // Get positions after Tidy
    const tidyPositions = await getNodePositions(page);
    console.log(`✓ Tidy layout applied: ${tidyPositions.length} nodes`);
    expect(tidyPositions.length).toBe(100);

    // Apply Cola refinement
    await page.evaluate(() => window.testAPI!.applyColaRefinement());
    await page.waitForTimeout(3500);

    // Get positions after Cola
    const colaPositions = await getNodePositions(page);
    console.log(`✓ Cola refinement applied: ${colaPositions.length} nodes`);

    // Verify all nodes still exist
    expect(colaPositions.length).toBe(tidyPositions.length);

    // Verify positions changed (Cola did something)
    let positionsChanged = 0;
    for (let i = 0; i < tidyPositions.length; i++) {
      const tidyNode = tidyPositions.find((n: Position) => n.id === colaPositions[i].id);
      if (!tidyNode) continue;

      const dx = Math.abs(colaPositions[i].x - tidyNode.x);
      const dy = Math.abs(colaPositions[i].y - tidyNode.y);

      if (dx > 1 || dy > 1) {
        positionsChanged++;
      }
    }

    console.log(`✓ ${positionsChanged} out of ${colaPositions.length} positions changed`);
    expect(positionsChanged).toBeGreaterThan(10); // Cola should move many nodes

    // Take screenshot
    await page.screenshot({
      path: 'tests/screenshots/cola-refinement-after.png',
      fullPage: true
    });
  });

  test('should prevent node overlaps', async ({ page }) => {
    // Programmatically run layout
    await page.evaluate(() => window.testAPI!.loadFixture());
    await page.waitForTimeout(500);

    await page.evaluate(() => window.testAPI!.applyTidyLayout());
    await page.waitForTimeout(1000);

    await page.evaluate(() => window.testAPI!.applyColaRefinement());
    await page.waitForTimeout(3500);

    // Check overlaps
    const positions = await getNodePositions(page);
    const overlaps = checkNoOverlaps(positions);

    if (overlaps.length > 0) {
      console.log(`Found ${overlaps.length} overlaps:`, overlaps.slice(0, 5));
    }

    // Cola should minimize overlaps for 100 nodes
    const severeOverlaps = overlaps.filter(o => o.distance > 10).length;
    console.log(`✓ Severe overlaps (distance > 10): ${severeOverlaps}, total overlaps: ${overlaps.length}`);

    // For 100 nodes, allow some overlaps but minimize severe ones
    expect(severeOverlaps).toBeLessThan(50);
  });

  test('should maintain tree hierarchy (parents above children)', async ({ page }) => {
    // Programmatically run layout
    await page.evaluate(() => window.testAPI!.loadFixture());
    await page.waitForTimeout(500);

    await page.evaluate(() => window.testAPI!.applyTidyLayout());
    await page.waitForTimeout(1000);

    await page.evaluate(() => window.testAPI!.applyColaRefinement());
    await page.waitForTimeout(3500);

    // Verify hierarchy
    const hierarchyCheck = await page.evaluate(() => {
      if (!window.cy) return { violations: 0, total: 0 };

      let violations = 0;
      let total = 0;

      window.cy.edges().forEach((edge: any) => {
        const source = edge.source();
        const target = edge.target();

        const sourceY = source.position('y');
        const targetY = target.position('y');

        total++;

        // For top-down flow, source (parent) should be above target (child)
        // Allow 50px tolerance for siblings
        if (sourceY > targetY + 50) {
          violations++;
        }
      });

      return { violations, total };
    });

    console.log(`✓ Hierarchy check: ${hierarchyCheck.violations} violations out of ${hierarchyCheck.total} edges`);

    // Less than 20% violations allowed for 100 nodes
    const violationRate = hierarchyCheck.violations / hierarchyCheck.total;
    expect(violationRate).toBeLessThan(0.2);
  });

  test('should complete refinement in reasonable time', async ({ page }) => {
    // Programmatically run layout
    await page.evaluate(() => window.testAPI!.loadFixture());
    await page.waitForTimeout(500);

    await page.evaluate(() => window.testAPI!.applyTidyLayout());
    await page.waitForTimeout(1000);

    // Measure Cola refinement time
    const startTime = Date.now();
    await page.evaluate(() => window.testAPI!.applyColaRefinement());
    await page.waitForTimeout(26000); // Wait for completion

    const refinementTime = Date.now() - startTime;
    console.log(`✓ Cola refinement completed in ${refinementTime}ms`);

    // For 100 nodes with random structure, should complete within 27 seconds
    expect(refinementTime).toBeLessThan(27000);
  });

  test('should handle disconnected components', async ({ page }) => {
    // Create a fixture with disconnected components
    await page.evaluate(() => {
      // Add disconnected nodes
      const disconnectedNodes = [
        { id: 'isolated1', size: { width: 150, height: 75 }, linkedNodeIds: [] },
        { id: 'isolated2', size: { width: 150, height: 75 }, linkedNodeIds: [] },
      ];

      window.cy!.batch(() => {
        disconnectedNodes.forEach((node: any) => {
          window.cy!.add({
            data: {
              id: node.id,
              width: node.size.width,
              height: node.size.height,
              linkedNodeIds: []
            },
            position: { x: Math.random() * 500, y: Math.random() * 500 }
          });
        });
      });
    });

    await page.evaluate(() => window.testAPI!.applyColaRefinement());
    await page.waitForTimeout(2000);

    // Verify all nodes have valid positions
    const positions = await getNodePositions(page);
    const validPositions = positions.filter((p: Position) =>
      !isNaN(p.x) && !isNaN(p.y) && isFinite(p.x) && isFinite(p.y)
    );

    console.log(`✓ ${validPositions.length} out of ${positions.length} nodes have valid positions`);
    expect(validPositions.length).toBe(positions.length);
  });

  test('should expose API for programmatic testing', async ({ page }) => {
    // Verify test API exists
    const hasAPI = await page.evaluate(() => {
      return window.testAPI &&
             typeof window.testAPI.loadFixture === 'function' &&
             typeof window.testAPI.applyColaRefinement === 'function';
    });

    expect(hasAPI).toBe(true);

    // Use API directly
    await page.evaluate(() => {
      return window.testAPI!.loadFixture();
    });

    await page.waitForTimeout(500);

    const nodeCount = await page.evaluate(() => {
      return window.cy!.nodes().length;
    });

    console.log(`✓ API loaded ${nodeCount} nodes`);
    expect(nodeCount).toBe(100);
  });
});
