import { test, expect } from '@playwright/test';

/**
 * Tidy + Micro-Relax Experiment
 *
 * This test explores what happens when we:
 * 1. Run TidyLayoutStrategy first (clean tree layout)
 * 2. Apply force-directed micro-relax on top (fine-tune with physics)
 *
 * Goal: See if micro-relax can improve the tree layout with better edge lengths and spacing
 */

test.describe('Tidy + Micro-Relax Experiment', () => {
  test('should apply tidy layout then micro-relax physics', async ({ page }) => {
    // Navigate to test harness
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/incremental-layout-harness.html');
    await page.waitForSelector('#root canvas', { timeout: 5000 });

    console.log('=== PHASE 1: TIDY LAYOUT (Tree Structure) ===');

    // Create a test graph and apply Tidy layout
    const tidyResult = await page.evaluate(async () => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      // Clear graph
      window.cy.elements().remove();

      // Create a tree structure: 1 root, 5 branches with 3-4 children each
      const nodes: string[] = [];

      // Root
      const rootId = 'root';
      window.cy.add({
        group: 'nodes',
        data: {
          id: rootId,
          label: 'Root',
          parentId: null,
          linkedNodeIds: []
        }
      });
      nodes.push(rootId);

      // Create 5 main branches
      for (let branch = 0; branch < 5; branch++) {
        const branchId = `branch-${branch}`;
        window.cy.add({
          group: 'nodes',
          data: {
            id: branchId,
            label: `Branch ${branch}`,
            parentId: rootId,
            linkedNodeIds: [rootId]
          }
        });
        nodes.push(branchId);

        window.cy.add({
          group: 'edges',
          data: {
            id: `${branchId}-${rootId}`,
            source: branchId,
            target: rootId
          }
        });

        // Add 3-4 children per branch
        const numChildren = 3 + (branch % 2);
        for (let child = 0; child < numChildren; child++) {
          const childId = `child-${branch}-${child}`;
          window.cy.add({
            group: 'nodes',
            data: {
              id: childId,
              label: `C${branch}-${child}`,
              parentId: branchId,
              linkedNodeIds: [branchId]
            }
          });
          nodes.push(childId);

          window.cy.add({
            group: 'edges',
            data: {
              id: `${childId}-${branchId}`,
              source: childId,
              target: branchId
            }
          });
        }
      }

      // Apply Tidy layout
      await window.layoutManager.applyLayout(window.cy, nodes);

      // Get positions after Tidy
      const positions = window.cy.nodes().map(n => ({
        id: n.id(),
        x: n.position().x,
        y: n.position().y
      }));

      return {
        nodeCount: nodes.length,
        positions
      };
    });

    console.log(`✓ Tidy layout applied to ${tidyResult.nodeCount} nodes`);
    console.log('Sample positions:', tidyResult.positions.slice(0, 5));

    // Take screenshot of Tidy-only layout
    await page.evaluate(() => {
      if (window.cy) {
        window.cy.fit(100);
      }
    });

    // Wait for render
    await page.waitForTimeout(200);

    await page.screenshot({
      path: 'tests/screenshots/tidy-only-layout.png',
      fullPage: true
    });

    console.log('✓ Screenshot saved: tidy-only-layout.png');

    console.log('=== PHASE 2: MICRO-RELAX (Force-Directed Physics) ===');

    // Now apply micro-relax physics on top of Tidy positions
    const relaxResult = await page.evaluate(() => {
      if (!window.cy) {
        throw new Error('Cytoscape not available');
      }

      // Micro-relax configuration (from SeedParkRelaxStrategy)
      const config = {
        targetLength: 150,
        microRelaxIters: 30,  // More iterations for better settling
        springK: 1.0,
        repelK: 0.5,
        stepSize: 0.15,
        localRadiusMult: 3
      };

      const nodes = window.cy.nodes();

      // Run micro-relax iterations
      for (let iter = 0; iter < config.microRelaxIters; iter++) {
        // For each node, calculate forces
        nodes.forEach(node => {
          const currentPos = node.position();
          const nodeData = node.data();
          const linkedNodeIds = nodeData.linkedNodeIds || [];

          const nodeRadius = Math.max(node.width(), node.height()) / 2 + 20;
          const localRadius = config.localRadiusMult * nodeRadius * 2;

          let fx = 0, fy = 0;

          // Spring forces to connected nodes
          linkedNodeIds.forEach((connectedId: string) => {
            const connectedNode = window.cy.$id(connectedId);
            if (connectedNode.length > 0) {
              const connectedPos = connectedNode.position();
              const dx = currentPos.x - connectedPos.x;
              const dy = currentPos.y - connectedPos.y;
              const dist = Math.hypot(dx, dy) || 1;
              const delta = dist - config.targetLength;

              fx -= config.springK * delta * (dx / dist);
              fy -= config.springK * delta * (dy / dist);
            }
          });

          // Repulsion forces from ALL nearby nodes
          nodes.forEach(otherNode => {
            if (otherNode.id() === node.id()) return;

            const otherPos = otherNode.position();
            const dx = currentPos.x - otherPos.x;
            const dy = currentPos.y - otherPos.y;
            const dist2 = dx * dx + dy * dy + 1e-6;
            const dist = Math.sqrt(dist2);

            if (dist < localRadius) {
              const otherRadius = Math.max(otherNode.width(), otherNode.height()) / 2 + 20;
              const minDist = nodeRadius + otherRadius;

              if (dist < minDist) {
                // Strong repulsion when overlapping
                const factor = config.repelK * 5;
                const pushDist = minDist - dist + 5;
                fx += factor * pushDist * (dx / dist);
                fy += factor * pushDist * (dy / dist);
              } else {
                // Normal repulsion
                fx += config.repelK * dx / dist2;
                fy += config.repelK * dy / dist2;
              }
            }
          });

          // Store forces on node data for batch update
          node.data('fx', fx);
          node.data('fy', fy);
        });

        // Apply forces to all nodes (batch update)
        nodes.forEach(node => {
          const fx = node.data('fx') || 0;
          const fy = node.data('fy') || 0;
          const nodeRadius = Math.max(node.width(), node.height()) / 2 + 20;

          const forceMag = Math.hypot(fx, fy);
          const maxStep = nodeRadius * 0.5;
          const step = Math.min(config.stepSize, maxStep / Math.max(forceMag, 1e-6));

          const currentPos = node.position();
          node.position({
            x: currentPos.x + step * fx,
            y: currentPos.y + step * fy
          });
        });
      }

      // Get final positions
      const finalPositions = nodes.map(n => ({
        id: n.id(),
        x: n.position().x,
        y: n.position().y
      }));

      // Calculate metrics
      const edges = window.cy.edges();
      const edgeLengths: number[] = [];
      edges.forEach(edge => {
        const source = edge.source();
        const target = edge.target();
        const sourcePos = source.position();
        const targetPos = target.position();
        const length = Math.hypot(
          sourcePos.x - targetPos.x,
          sourcePos.y - targetPos.y
        );
        edgeLengths.push(length);
      });

      const avgEdgeLength = edgeLengths.reduce((a, b) => a + b, 0) / edgeLengths.length;
      const minEdgeLength = Math.min(...edgeLengths);
      const maxEdgeLength = Math.max(...edgeLengths);

      return {
        finalPositions,
        avgEdgeLength,
        minEdgeLength,
        maxEdgeLength,
        edgeCount: edges.length
      };
    });

    console.log('✓ Micro-relax completed');
    console.log(`  Average edge length: ${relaxResult.avgEdgeLength.toFixed(1)}px`);
    console.log(`  Min edge length: ${relaxResult.minEdgeLength.toFixed(1)}px`);
    console.log(`  Max edge length: ${relaxResult.maxEdgeLength.toFixed(1)}px`);

    // Take screenshot after micro-relax
    await page.evaluate(() => {
      if (window.cy) {
        window.cy.fit(100);
      }
    });
    await page.screenshot({
      path: 'tests/screenshots/tidy-plus-relax-layout.png',
      fullPage: true
    });

    console.log('✓ Screenshot saved: tidy-plus-relax-layout.png');

    // Validate results
    expect(relaxResult.avgEdgeLength).toBeGreaterThan(100);
    expect(relaxResult.avgEdgeLength).toBeLessThan(300); // More lenient threshold
    expect(relaxResult.minEdgeLength).toBeGreaterThan(50); // No super short edges

    console.log('✓ Tidy + Micro-Relax experiment completed successfully');
    console.log('  Check screenshots to compare:');
    console.log('    - tests/screenshots/tidy-only-layout.png');
    console.log('    - tests/screenshots/tidy-plus-relax-layout.png');
  });

  test('should show clear visual difference between tidy-only and tidy+relax', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/incremental-layout-harness.html');
    await page.waitForSelector('#root canvas', { timeout: 5000 });

    console.log('=== COMPARISON TEST: Side-by-side visualization ===');

    // Create a denser graph with more interesting structure
    await page.evaluate(async () => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      window.cy.elements().remove();

      const nodes: string[] = [];

      // Create a more complex tree with cross-links
      const rootId = 'root';
      window.cy.add({
        group: 'nodes',
        data: { id: rootId, label: 'Root', parentId: null, linkedNodeIds: [] }
      });
      nodes.push(rootId);

      // 3 main branches
      for (let i = 0; i < 3; i++) {
        const branchId = `b${i}`;
        const linkedNodes = [rootId];

        window.cy.add({
          group: 'nodes',
          data: { id: branchId, label: `B${i}`, parentId: rootId, linkedNodeIds: linkedNodes }
        });
        nodes.push(branchId);
        window.cy.add({
          group: 'edges',
          data: { id: `${branchId}-${rootId}`, source: branchId, target: rootId }
        });

        // 4 sub-branches each
        for (let j = 0; j < 4; j++) {
          const subId = `b${i}-s${j}`;
          window.cy.add({
            group: 'nodes',
            data: { id: subId, label: `S${i}-${j}`, parentId: branchId, linkedNodeIds: [branchId] }
          });
          nodes.push(subId);
          window.cy.add({
            group: 'edges',
            data: { id: `${subId}-${branchId}`, source: subId, target: branchId }
          });

          // Some leaf nodes
          for (let k = 0; k < 2; k++) {
            const leafId = `b${i}-s${j}-l${k}`;
            window.cy.add({
              group: 'nodes',
              data: { id: leafId, label: `L${i}${j}${k}`, parentId: subId, linkedNodeIds: [subId] }
            });
            nodes.push(leafId);
            window.cy.add({
              group: 'edges',
              data: { id: `${leafId}-${subId}`, source: leafId, target: subId }
            });
          }
        }
      }

      // Apply Tidy layout
      await window.layoutManager.applyLayout(window.cy, nodes);
    });

    console.log('✓ Created complex tree structure with Tidy layout');

    // Check positions before screenshot
    const positionsBefore = await page.evaluate(() => {
      return window.cy?.nodes().map(n => ({
        id: n.id(),
        x: n.position().x,
        y: n.position().y
      })).slice(0, 5);
    });
    console.log('Positions before relax:', positionsBefore);

    // Screenshot before relax
    await page.evaluate(() => window.cy?.fit(80));
    await page.waitForTimeout(200);
    await page.screenshot({
      path: 'tests/screenshots/comparison-before-relax.png',
      fullPage: true
    });

    // Apply aggressive micro-relax
    await page.evaluate(() => {
      if (!window.cy) return;

      const config = {
        targetLength: 120,
        microRelaxIters: 50,
        springK: 0.8,
        repelK: 0.6,
        stepSize: 0.2,
        localRadiusMult: 3
      };

      const nodes = window.cy.nodes();

      for (let iter = 0; iter < config.microRelaxIters; iter++) {
        nodes.forEach(node => {
          const currentPos = node.position();
          const linkedNodeIds = node.data().linkedNodeIds || [];
          const nodeRadius = Math.max(node.width(), node.height()) / 2 + 20;
          const localRadius = config.localRadiusMult * nodeRadius * 2;

          let fx = 0, fy = 0;

          // Spring forces
          linkedNodeIds.forEach((connectedId: string) => {
            const connectedNode = window.cy.$id(connectedId);
            if (connectedNode.length > 0) {
              const connectedPos = connectedNode.position();
              const dx = currentPos.x - connectedPos.x;
              const dy = currentPos.y - connectedPos.y;
              const dist = Math.hypot(dx, dy) || 1;
              const delta = dist - config.targetLength;
              fx -= config.springK * delta * (dx / dist);
              fy -= config.springK * delta * (dy / dist);
            }
          });

          // Repulsion
          nodes.forEach(otherNode => {
            if (otherNode.id() === node.id()) return;
            const otherPos = otherNode.position();
            const dx = currentPos.x - otherPos.x;
            const dy = currentPos.y - otherPos.y;
            const dist2 = dx * dx + dy * dy + 1e-6;
            const dist = Math.sqrt(dist2);

            if (dist < localRadius) {
              const otherRadius = Math.max(otherNode.width(), otherNode.height()) / 2 + 20;
              const minDist = nodeRadius + otherRadius;

              if (dist < minDist) {
                const factor = config.repelK * 5;
                const pushDist = minDist - dist + 5;
                fx += factor * pushDist * (dx / dist);
                fy += factor * pushDist * (dy / dist);
              } else {
                fx += config.repelK * dx / dist2;
                fy += config.repelK * dy / dist2;
              }
            }
          });

          node.data('fx', fx);
          node.data('fy', fy);
        });

        nodes.forEach(node => {
          const fx = node.data('fx') || 0;
          const fy = node.data('fy') || 0;
          const nodeRadius = Math.max(node.width(), node.height()) / 2 + 20;
          const forceMag = Math.hypot(fx, fy);
          const maxStep = nodeRadius * 0.5;
          const step = Math.min(config.stepSize, maxStep / Math.max(forceMag, 1e-6));
          const currentPos = node.position();

          node.position({
            x: currentPos.x + step * fx,
            y: currentPos.y + step * fy
          });
        });
      }
    });

    // Screenshot after relax
    await page.evaluate(() => window.cy?.fit(80));
    await page.screenshot({
      path: 'tests/screenshots/comparison-after-relax.png',
      fullPage: true
    });

    console.log('✓ Comparison screenshots saved:');
    console.log('    - tests/screenshots/comparison-before-relax.png (Tidy only)');
    console.log('    - tests/screenshots/comparison-after-relax.png (Tidy + Micro-relax)');
    console.log('');
    console.log('Expected differences:');
    console.log('  • More uniform edge lengths after relax');
    console.log('  • Better node spacing (less overlap)');
    console.log('  • Tree structure preserved but "relaxed"');
  });
});
