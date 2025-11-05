import { test, expect } from '@playwright/test';

/**
 * Layout Integration Tests
 *
 * Tests the complete layout workflow: bulk load followed by incremental updates.
 * This mirrors the real production flow and ensures both phases work correctly.
 */

test.describe('Layout Integration - Bulk Load + Incremental Updates', () => {
  test('should bulk load 50 nodes then incrementally add 20 more', async ({ page }) => {
    // Navigate to test harness
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/incremental-layout-harness.html');
    await page.waitForSelector('#root canvas', { timeout: 5000 });

    console.log('=== PHASE 1: BULK LOAD 50 NODES ===');

    // Bulk load 50 nodes at once
    const bulkLoadResult = await page.evaluate(async () => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      const startTime = performance.now();

      // Clear graph
      window.cy.elements().remove();

      // Create 50 nodes in a tree structure (no incremental layout yet)
      const allNodeIds: string[] = [];

      for (let i = 0; i < 50; i++) {
        const nodeId = `bulk-${i}`;
        const parentId = i > 0 ? `bulk-${Math.floor((i - 1) / 2)}` : null; // Binary tree structure

        window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Bulk ${i}`,
            parentId: parentId,
            linkedNodeIds: parentId ? [parentId] : []
          }
        });

        // Add edge to parent
        if (parentId) {
          window.cy.add({
            group: 'edges',
            data: {
              id: `${nodeId}-${parentId}`,
              source: nodeId,
              target: parentId
            }
          });
        }

        allNodeIds.push(nodeId);
      }

      // Apply bulk layout (this should trigger fullLayout)
      await window.layoutManager.applyLayout(window.cy, allNodeIds);

      const positions = window.cy.nodes().map(n => ({
        id: n.id(),
        x: n.position().x,
        y: n.position().y
      }));

      const endTime = performance.now();

      return {
        nodeCount: allNodeIds.length,
        timeMs: endTime - startTime,
        positions
      };
    });

    console.log(`Bulk load: ${bulkLoadResult.nodeCount} nodes in ${bulkLoadResult.timeMs.toFixed(1)}ms`);

    // Validate bulk load results
    expect(bulkLoadResult.nodeCount).toBe(50);
    expect(bulkLoadResult.timeMs).toBeLessThan(1000);

    // Check that nodes have distinct Y coordinates (not all at 0)
    const yCoords = bulkLoadResult.positions.map(p => p.y);
    const uniqueYCoords = new Set(yCoords);

    console.log(`Unique Y coordinates: ${uniqueYCoords.size} out of ${yCoords.length} nodes`);
    console.log(`Sample Y coords:`, Array.from(uniqueYCoords).slice(0, 10));

    // This is the critical check - ensures bulk layout sets Y positions correctly
    expect(uniqueYCoords.size).toBeGreaterThan(5); // Should have multiple levels

    // Check that not all nodes are at y=0 (the bug we introduced)
    const allAtZero = yCoords.every(y => y === 0);
    expect(allAtZero).toBe(false);

    // Check nodes are reasonably spread out
    const uniquePositions = new Set(
      bulkLoadResult.positions.map(p => `${Math.round(p.x)},${Math.round(p.y)}`)
    );
    expect(uniquePositions.size).toBeGreaterThan(45); // Most nodes should have unique positions

    console.log('✓ Bulk load completed with proper Y-coordinate distribution');

    console.log('=== PHASE 2: INCREMENTAL ADD 20 NODES ===');

    // Now add 20 more nodes incrementally
    const incrementalResults = await page.evaluate(async () => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      const results = [];
      const startTime = performance.now();

      for (let i = 0; i < 20; i++) {
        const nodeId = `incr-${i}`;
        const parentId = `bulk-${Math.floor(Math.random() * 50)}`; // Random parent from bulk nodes

        // Add node
        window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Incr ${i}`,
            parentId: parentId,
            linkedNodeIds: [parentId]
          }
        });

        // Add edge
        window.cy.add({
          group: 'edges',
          data: {
            id: `${nodeId}-${parentId}`,
            source: nodeId,
            target: parentId
          }
        });

        // Position incrementally
        await window.layoutManager.positionNode(window.cy, nodeId, parentId);

        const pos = window.cy.$id(nodeId).position();
        results.push({
          id: nodeId,
          x: pos.x,
          y: pos.y
        });

        // Small delay to simulate real-time additions
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const endTime = performance.now();

      return {
        count: results.length,
        timeMs: endTime - startTime,
        positions: results,
        totalNodes: window.cy.nodes().length
      };
    });

    console.log(`Incremental add: ${incrementalResults.count} nodes in ${incrementalResults.timeMs.toFixed(1)}ms`);

    // Validate incremental results
    expect(incrementalResults.count).toBe(20);
    expect(incrementalResults.totalNodes).toBe(70);

    // Check that incremental nodes also have proper Y positions
    const incrYCoords = incrementalResults.positions.map(p => p.y);
    const allIncrAtZero = incrYCoords.every(y => y === 0);
    expect(allIncrAtZero).toBe(false);

    // Check positions are distinct
    const incrUniquePositions = new Set(
      incrementalResults.positions.map(p => `${Math.round(p.x)},${Math.round(p.y)}`)
    );
    expect(incrUniquePositions.size).toBeGreaterThan(18);

    console.log('✓ Incremental additions completed with proper positioning');

    // Final validation: check entire graph
    const finalGraphState = await page.evaluate(() => {
      if (!window.cy) return null;

      const nodes = window.cy.nodes();
      const edges = window.cy.edges();

      const positions = nodes.map(n => ({
        x: n.position().x,
        y: n.position().y
      }));

      // Check for overlaps
      let overlapCount = 0;
      const MINIMUM_DISTANCE = 30;

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dist = Math.hypot(
            positions[i].x - positions[j].x,
            positions[i].y - positions[j].y
          );
          if (dist < MINIMUM_DISTANCE) {
            overlapCount++;
          }
        }
      }

      return {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        overlapCount,
        yCoords: positions.map(p => p.y)
      };
    });

    expect(finalGraphState.nodeCount).toBe(70);
    expect(finalGraphState.edgeCount).toBeGreaterThanOrEqual(69); // At least one edge per child

    // Check Y-coordinate distribution for entire graph
    const finalUniqueY = new Set(finalGraphState.yCoords);
    console.log(`Final graph: ${finalUniqueY.size} unique Y levels for ${finalGraphState.nodeCount} nodes`);
    expect(finalUniqueY.size).toBeGreaterThan(5);

    // Check overlap count is reasonable
    console.log(`Final overlap count: ${finalGraphState.overlapCount}`);
    expect(finalGraphState.overlapCount).toBeLessThan(50); // Reasonable for 70 nodes

    // Take screenshot
    await page.evaluate(() => {
      if (window.cy) {
        window.cy.fit(50);
      }
    });
    await page.screenshot({
      path: 'tests/screenshots/layout-integration-bulk-plus-incremental.png',
      fullPage: true
    });

    console.log('✓ Layout integration test completed successfully');
  });

  test('should handle rapid incremental additions after bulk load', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/incremental-layout-harness.html');
    await page.waitForSelector('#root canvas', { timeout: 5000 });

    // Bulk load 30 nodes
    await page.evaluate(async () => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      window.cy.elements().remove();
      const allNodeIds: string[] = [];

      for (let i = 0; i < 30; i++) {
        const nodeId = `base-${i}`;
        const parentId = i > 0 ? `base-${i - 1}` : null;

        window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Base ${i}`,
            parentId: parentId,
            linkedNodeIds: parentId ? [parentId] : []
          }
        });

        if (parentId) {
          window.cy.add({
            group: 'edges',
            data: {
              id: `${nodeId}-${parentId}`,
              source: nodeId,
              target: parentId
            }
          });
        }

        allNodeIds.push(nodeId);
      }

      await window.layoutManager.applyLayout(window.cy, allNodeIds);
    });

    console.log('✓ Bulk loaded 30 base nodes');

    // Rapidly add 10 more nodes
    const rapidResult = await page.evaluate(async () => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      const startTime = performance.now();
      const positions = [];

      for (let i = 0; i < 10; i++) {
        const nodeId = `rapid-${i}`;
        const parentId = `base-${i}`;

        window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Rapid ${i}`,
            parentId: parentId,
            linkedNodeIds: [parentId]
          }
        });

        window.cy.add({
          group: 'edges',
          data: {
            id: `${nodeId}-${parentId}`,
            source: nodeId,
            target: parentId
          }
        });

        await window.layoutManager.positionNode(window.cy, nodeId, parentId);
        positions.push(window.cy.$id(nodeId).position());
      }

      const endTime = performance.now();

      return {
        timeMs: endTime - startTime,
        positions,
        totalNodes: window.cy.nodes().length
      };
    });

    console.log(`Rapid addition: 10 nodes in ${rapidResult.timeMs.toFixed(1)}ms`);

    expect(rapidResult.timeMs).toBeLessThan(500);
    expect(rapidResult.totalNodes).toBe(40);

    // Check positions are distinct
    const uniquePositions = new Set(
      rapidResult.positions.map(p => `${Math.round(p.x)},${Math.round(p.y)}`)
    );
    expect(uniquePositions.size).toBeGreaterThan(8);

    console.log('✓ Rapid additions after bulk load completed successfully');
  });

  test('should layout children in radial/circular pattern with both left and right hemispheres', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/incremental-layout-harness.html');
    await page.waitForSelector('#root canvas', { timeout: 5000 });

    console.log('=== TESTING RADIAL LAYOUT ===');

    const radialTest = await page.evaluate(async () => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      // Clear graph
      window.cy.elements().remove();

      // Create a parent with 10 children (enough to trigger radial spread)
      const parentId = 'parent-0';
      window.cy.add({
        group: 'nodes',
        data: {
          id: parentId,
          label: 'Parent',
          parentId: null,
          linkedNodeIds: []
        }
      });

      const childIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const childId = `child-${i}`;
        childIds.push(childId);

        window.cy.add({
          group: 'nodes',
          data: {
            id: childId,
            label: `Child ${i}`,
            parentId: parentId,
            linkedNodeIds: [parentId]
          }
        });

        window.cy.add({
          group: 'edges',
          data: {
            id: `${childId}-${parentId}`,
            source: childId,
            target: parentId
          }
        });
      }

      // Apply layout (await the async call!)
      await window.layoutManager.applyLayout(window.cy, [parentId, ...childIds]);

      // Get parent position
      const parentPos = window.cy.$id(parentId).position();

      // Get all children positions
      const childPositions = childIds.map(id => {
        const pos = window.cy.$id(id).position();
        return {
          id,
          x: pos.x,
          y: pos.y,
          relativeX: pos.x - parentPos.x,
          relativeY: pos.y - parentPos.y
        };
      });

      // Calculate hemispheres
      const leftHemisphere = childPositions.filter(p => p.relativeX < 0);
      const rightHemisphere = childPositions.filter(p => p.relativeX > 0);

      // Calculate vertical spread
      const yCoords = childPositions.map(p => p.y);
      const minY = Math.min(...yCoords);
      const maxY = Math.max(...yCoords);
      const verticalSpread = maxY - minY;

      // Calculate if children are on an arc
      const distances = childPositions.map(p =>
        Math.sqrt(p.relativeX * p.relativeX + p.relativeY * p.relativeY)
      );
      const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
      const distanceVariance = distances.reduce((acc, d) => acc + Math.pow(d - avgDistance, 2), 0) / distances.length;

      return {
        parentPos,
        childPositions,
        leftCount: leftHemisphere.length,
        rightCount: rightHemisphere.length,
        verticalSpread,
        avgDistance,
        distanceVariance,
        leftHemisphere: leftHemisphere.map(p => ({ id: p.id, x: p.x.toFixed(1), y: p.y.toFixed(1) })),
        rightHemisphere: rightHemisphere.map(p => ({ id: p.id, x: p.x.toFixed(1), y: p.y.toFixed(1) }))
      };
    });

    console.log(`Parent position: (${radialTest.parentPos.x.toFixed(1)}, ${radialTest.parentPos.y.toFixed(1)})`);
    console.log(`Left hemisphere: ${radialTest.leftCount} children`);
    console.log(`Right hemisphere: ${radialTest.rightCount} children`);
    console.log(`Vertical spread: ${radialTest.verticalSpread.toFixed(1)}px`);
    console.log(`Average distance from parent: ${radialTest.avgDistance.toFixed(1)}px`);
    console.log('Left hemisphere children:', radialTest.leftHemisphere);
    console.log('Right hemisphere children:', radialTest.rightHemisphere);

    // CRITICAL: Check that children appear on BOTH sides (radial layout splits left/right)
    expect(radialTest.leftCount).toBeGreaterThan(0);
    expect(radialTest.rightCount).toBeGreaterThan(0);
    // Note: The split may not be exactly 5-5 due to tidy's collision detection
    // placing some children slightly off-center before the radial transform
    expect(radialTest.leftCount).toBeGreaterThanOrEqual(1); // At least 1 on left
    expect(radialTest.rightCount).toBeGreaterThanOrEqual(1); // At least 1 on right

    // Check vertical spread (radial layout should bend children vertically)
    expect(radialTest.verticalSpread).toBeGreaterThan(50); // Should have significant vertical spread

    // Check that children are roughly on an arc (distance variance should be low)
    const stdDev = Math.sqrt(radialTest.distanceVariance);
    const coefficientOfVariation = stdDev / radialTest.avgDistance;
    console.log(`Distance coefficient of variation: ${coefficientOfVariation.toFixed(3)}`);
    expect(coefficientOfVariation).toBeLessThan(0.3); // Distances should be relatively consistent (on an arc)

    // Take screenshot
    await page.evaluate(() => {
      if (window.cy) {
        window.cy.fit(100);
      }
    });
    await page.screenshot({
      path: 'tests/screenshots/radial-layout-hemispheres.png',
      fullPage: true
    });

    console.log('✓ Radial layout test completed - children distributed on both hemispheres');
  });
});
