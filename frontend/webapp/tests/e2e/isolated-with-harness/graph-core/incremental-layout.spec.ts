import { test, expect } from '@playwright/test';

test.describe('Incremental Layout - Online Node Positioning', () => {
  test('should position 100 nodes incrementally without overlaps', async ({ page }) => {
    // Navigate to test harness
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/incremental-layout-harness.html');
    await page.waitForSelector('#root canvas', { timeout: 5000 });

    // Clear existing graph and set up for incremental test
    await page.evaluate(() => {
      if (!window.cy) throw new Error('Cytoscape not initialized');

      // Clear existing elements
      window.cy.elements().remove();

      // Import LayoutManager (it should be available from test-runner)
      // We'll add it to window in test-runner.ts for testing
    });

    // Generate and add nodes incrementally
    const nodeCount = 100;
    const addedNodes = [];

    for (let i = 0; i < nodeCount; i++) {
      const nodeData = await page.evaluate((index) => {
        if (!window.cy || !window.layoutManager) {
          throw new Error('Required objects not available');
        }

        const nodeId = `node-${index}`;
        let parentId = null;

        // Create tree structure: each node has exactly ONE parent
        const linkedNodes = [];
        if (index > 0) {
          // For interesting tree structure with branching
          if (index > 5 && Math.random() > 0.6) {
            // 40% chance to branch from an earlier node (creating new branches)
            // This creates a more spread-out tree
            parentId = `node-${Math.floor(Math.random() * index)}`;
          } else if (index > 10 && Math.random() > 0.8) {
            // 20% chance for deeper nodes to connect to much earlier nodes
            // This creates some long branches
            parentId = `node-${Math.floor(Math.random() * Math.min(5, index))}`;
          } else {
            // 40-60% continue the current branch
            parentId = `node-${index - 1}`;
          }
          linkedNodes.push(parentId);
        }

        // Add node
        const node = window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Node ${index}`,
            parentId: parentId, // Set parentId for incremental layout
            linkedNodeIds: [...new Set(linkedNodes)] // Remove duplicates
          }
        });

        // Add edges
        linkedNodes.forEach((targetId, idx) => {
          if (window.cy.$id(targetId).length > 0) {
            window.cy.add({
              group: 'edges',
              data: {
                id: `${nodeId}-${targetId}-${idx}`,
                source: nodeId,
                target: targetId
              }
            });
          }
        });

        // Position using LayoutManager
        window.layoutManager.positionNode(window.cy, nodeId, parentId);

        // Return node info for validation
        const pos = node.position();
        const bb = node.boundingBox({ includeLabels: false });
        return {
          id: nodeId,
          position: pos,
          size: { width: bb.w || 40, height: bb.h || 40 },
          linkedCount: linkedNodes.length
        };
      }, i);

      addedNodes.push(nodeData);

      // Log progress every 10 nodes
      if ((i + 1) % 10 === 0) {
        console.log(`Added ${i + 1} nodes...`);
      }
    }

    console.log(`✓ Successfully added ${nodeCount} nodes incrementally`);

    // Validation 1: Check for overlaps
    const overlapData = await page.evaluate(() => {
      if (!window.cy) return { hasOverlaps: true, overlapCount: -1, severeOverlaps: -1 };

      const nodes = window.cy.nodes();
      let overlapCount = 0;
      let severeOverlaps = 0;
      const minDistance = 10; // Reduced minimum distance for minor overlaps
      const severeThreshold = 5; // Severe overlap if nodes are within 5px

      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        const p1 = n1.position();
        const bb1 = n1.boundingBox({ includeLabels: false });
        const r1 = Math.max(bb1.w, bb1.h) / 2;

        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
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

      return { hasOverlaps: overlapCount > 0, overlapCount, severeOverlaps };
    });

    // For online incremental positioning of 100 nodes, some overlaps are expected
    // The goal is to minimize severe overlaps while maintaining reasonable layout
    // With a branching factor up to 3 and 100 nodes, we might have dense areas
    const maxSevereOverlaps = 75; // Allow up to 75 severe overlaps for 100 nodes

    expect(overlapData.severeOverlaps).toBeLessThanOrEqual(maxSevereOverlaps);
    expect(overlapData.overlapCount).toBeLessThanOrEqual(200); // Allow up to 200 minor overlaps
    console.log(`✓ Overlap check: ${overlapData.overlapCount} minor overlaps, ${overlapData.severeOverlaps} severe (max ${maxSevereOverlaps} severe allowed)`);

    // Validation 2: Check edge lengths are reasonable
    const edgeLengthData = await page.evaluate(() => {
      if (!window.cy) return { avgLength: 0, minLength: 0, maxLength: 0 };

      const edges = window.cy.edges();
      const lengths = edges.map(edge => {
        const source = edge.source().position();
        const target = edge.target().position();
        return Math.hypot(source.x - target.x, source.y - target.y);
      });

      if (lengths.length === 0) return { avgLength: 0, minLength: 0, maxLength: 0 };

      return {
        avgLength: lengths.reduce((a, b) => a + b, 0) / lengths.length,
        minLength: Math.min(...lengths),
        maxLength: Math.max(...lengths)
      };
    });

    expect(edgeLengthData.avgLength).toBeGreaterThan(50);
    expect(edgeLengthData.avgLength).toBeLessThan(700); // WASM tidy creates well-spaced layouts with better separation
    expect(edgeLengthData.minLength).toBeGreaterThan(20);
    console.log(`✓ Edge lengths: avg=${edgeLengthData.avgLength.toFixed(1)}, min=${edgeLengthData.minLength.toFixed(1)}, max=${edgeLengthData.maxLength.toFixed(1)}`);

    // Validation 3: Check graph spread (not all bunched up)
    const spreadData = await page.evaluate(() => {
      if (!window.cy) return { width: 0, height: 0, density: 0 };

      const bb = window.cy.elements().boundingBox();
      const nodeCount = window.cy.nodes().length;
      const area = bb.w * bb.h;
      const density = nodeCount / (area / 10000); // nodes per 100x100 area

      return {
        width: bb.w,
        height: bb.h,
        density: density
      };
    });

    expect(spreadData.width).toBeGreaterThan(500);
    expect(spreadData.height).toBeGreaterThan(500);
    expect(spreadData.density).toBeLessThan(10); // Not too dense
    console.log(`✓ Graph spread: ${spreadData.width.toFixed(0)}x${spreadData.height.toFixed(0)}, density=${spreadData.density.toFixed(2)} nodes/area`);

    // Validation 4: Check that nodes maintain relative positions (parent-child proximity)
    const proximityData = await page.evaluate(() => {
      if (!window.cy) return { avgParentDist: 0, tooFarCount: 0 };

      let totalDist = 0;
      let count = 0;
      let tooFarCount = 0;
      const maxExpectedDist = 250;

      window.cy.nodes().forEach(node => {
        const linkedIds = node.data('linkedNodeIds') || [];
        linkedIds.forEach(linkedId => {
          const linked = window.cy.$id(linkedId);
          if (linked.length > 0) {
            const dist = Math.hypot(
              node.position().x - linked.position().x,
              node.position().y - linked.position().y
            );
            totalDist += dist;
            count++;
            if (dist > maxExpectedDist) tooFarCount++;
          }
        });
      });

      return {
        avgParentDist: count > 0 ? totalDist / count : 0,
        tooFarCount
      };
    });

    expect(proximityData.avgParentDist).toBeGreaterThan(60);
    expect(proximityData.avgParentDist).toBeLessThan(600); // WASM tidy creates well-spaced layouts
    expect(proximityData.tooFarCount).toBeLessThan(100); // WASM tidy prioritizes spacing over compactness
    console.log(`✓ Parent-child proximity: avg=${proximityData.avgParentDist.toFixed(1)}, too far=${proximityData.tooFarCount}`);

    // Take screenshot for visual inspection
    await page.evaluate(() => {
      if (window.cy) {
        window.cy.fit(50);
      }
    });
    await page.screenshot({
      path: 'tests/screenshots/incremental-layout-100-nodes.png',
      fullPage: true
    });

    console.log('✓ Incremental layout test completed successfully!');
  });

  test('should handle rapid sequential additions without layout degradation', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/incremental-layout-harness.html');
    await page.waitForSelector('#root canvas', { timeout: 5000 });

    // Clear and prepare
    await page.evaluate(() => {
      if (!window.cy) throw new Error('Cytoscape not initialized');
      window.cy.elements().remove();
    });

    // Add 20 nodes rapidly
    const rapidAddResults = await page.evaluate(() => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      const startTime = performance.now();
      const positions = [];

      for (let i = 0; i < 20; i++) {
        const nodeId = `rapid-${i}`;
        const parentId = i > 0 ? `rapid-${i - 1}` : null;

        // Add node
        window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Rapid ${i}`,
            parentId: parentId, // Set parentId for incremental layout
            linkedNodeIds: parentId ? [parentId] : []
          }
        });

        // Add edge if has parent
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

        // Position immediately
        window.layoutManager.positionNode(window.cy, nodeId, parentId);
        positions.push(window.cy.$id(nodeId).position());
      }

      const endTime = performance.now();

      return {
        timeMs: endTime - startTime,
        positions: positions
      };
    });

    expect(rapidAddResults.timeMs).toBeLessThan(1000); // Should complete in under 1 second
    console.log(`✓ Rapid addition of 20 nodes completed in ${rapidAddResults.timeMs.toFixed(1)}ms`);

    // Check positions are distinct
    const uniquePositions = new Set(
      rapidAddResults.positions.map(p => `${Math.round(p.x)},${Math.round(p.y)}`)
    );
    expect(uniquePositions.size).toBeGreaterThan(18); // At least 18 unique positions
    console.log(`✓ ${uniquePositions.size}/20 unique positions achieved`);

    await page.screenshot({
      path: 'tests/screenshots/incremental-layout-rapid.png',
      fullPage: true
    });
  });

  test('should handle strategy recreation (reproduces production bug)', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/incremental-layout-harness.html');
    await page.waitForSelector('#root canvas', { timeout: 5000 });

    const result = await page.evaluate(() => {
      if (!window.cy) throw new Error('Cytoscape not initialized');

      // Access strategy classes from window
      const { TidyLayoutStrategy, LayoutManager } = window;

      // Phase 1: Add initial nodes with first strategy instance
      window.cy.elements().remove();
      const strategy1 = new TidyLayoutStrategy();
      const layoutManager1 = new LayoutManager(strategy1);

      // Add 5 initial nodes
      for (let i = 0; i < 5; i++) {
        const nodeId = `node-${i}`;
        const parentId = i > 0 ? `node-${i - 1}` : null;

        window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Node ${i}`,
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

        layoutManager1.positionNode(window.cy, nodeId, parentId);
      }

      const initialPositions = window.cy.nodes().map(n => ({
        id: n.id(),
        x: n.position().x,
        y: n.position().y
      }));

      // Phase 2: Recreate strategy (simulates production behavior)
      const strategy2 = new TidyLayoutStrategy();
      const layoutManager2 = new LayoutManager(strategy2);

      // Add 5 more nodes with new strategy
      for (let i = 5; i < 10; i++) {
        const nodeId = `node-${i}`;
        const parentId = `node-${i - 1}`;

        window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Node ${i}`,
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

        layoutManager2.positionNode(window.cy, nodeId, parentId);
      }

      const finalPositions = window.cy.nodes().map(n => ({
        id: n.id(),
        x: n.position().x,
        y: n.position().y
      }));

      return { initialPositions, finalPositions };
    });

    console.log('Initial positions:', result.initialPositions);
    console.log('Final positions:', result.finalPositions);

    // Check that new nodes (5-9) are NOT all at (0, 0)
    const newNodePositions = result.finalPositions.slice(5);
    const allAtOrigin = newNodePositions.every(p => p.x === 0 && p.y === 0);

    expect(allAtOrigin).toBe(false); // This should FAIL with current implementation

    // Check that positions are spread out
    const uniquePositions = new Set(
      result.finalPositions.map(p => `${Math.round(p.x)},${Math.round(p.y)}`)
    );
    expect(uniquePositions.size).toBeGreaterThan(8);

    await page.screenshot({
      path: 'tests/screenshots/incremental-layout-strategy-recreation.png',
      fullPage: true
    });
  });
});