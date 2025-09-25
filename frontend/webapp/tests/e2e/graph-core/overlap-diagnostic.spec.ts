import { test, expect } from '@playwright/test';

test('diagnose overlap issues in complex graphs', async ({ page }) => {
  await page.goto('http://localhost:3001/graph-test.html');
  await page.waitForSelector('#graph-container canvas', { timeout: 5000 });

  // Clear existing graph
  await page.evaluate(() => {
    if (!window.cy) throw new Error('Cytoscape not initialized');
    window.cy.elements().remove();
  });

  // Add nodes with controlled branching to understand overlap issues
  const analysis = await page.evaluate(() => {
    if (!window.cy || !window.layoutManager) {
      throw new Error('Required objects not available');
    }

    const nodePositions = new Map();
    const overlaps = [];
    const edgeInfo = [];

    // Add 30 nodes with branching (simpler than 100 for analysis)
    for (let i = 0; i < 30; i++) {
      const nodeId = `node-${i}`;
      const linkedNodes = [];

      // Connect to previous node (linear chain)
      if (i > 0) {
        linkedNodes.push(`node-${i - 1}`);
      }

      // Add branching connections
      if (i > 5 && Math.random() > 0.6) {
        const branch1 = Math.floor(Math.random() * (i - 1));
        if (branch1 !== i - 1) {
          linkedNodes.push(`node-${branch1}`);
        }
      }

      if (i > 10 && Math.random() > 0.8) {
        const branch2 = Math.floor(Math.random() * (i - 1));
        if (!linkedNodes.includes(`node-${branch2}`)) {
          linkedNodes.push(`node-${branch2}`);
        }
      }

      // Add node
      const node = window.cy.add({
        group: 'nodes',
        data: {
          id: nodeId,
          label: `N${i}`,
          linkedNodeIds: linkedNodes
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

      // Get position before layout
      const beforePos = { ...node.position() };

      // Position using LayoutManager
      const primaryParent = linkedNodes[0] || null;
      window.layoutManager.positionNode(window.cy, nodeId, primaryParent);

      // Get position after layout
      const afterPos = node.position();
      nodePositions.set(nodeId, afterPos);

      // Measure edge lengths
      linkedNodes.forEach(targetId => {
        const target = window.cy.$id(targetId);
        if (target.length > 0) {
          const targetPos = target.position();
          const distance = Math.hypot(
            afterPos.x - targetPos.x,
            afterPos.y - targetPos.y
          );
          edgeInfo.push({
            from: nodeId,
            to: targetId,
            distance,
            isPrimary: targetId === primaryParent
          });
        }
      });

      // Check for overlaps with all existing nodes
      const bb = node.boundingBox({ includeLabels: false });
      const nodeRadius = Math.max(bb.w, bb.h) / 2;

      nodePositions.forEach((otherPos, otherId) => {
        if (otherId !== nodeId) {
          const otherNode = window.cy.$id(otherId);
          if (otherNode.length > 0) {
            const otherBB = otherNode.boundingBox({ includeLabels: false });
            const otherRadius = Math.max(otherBB.w, otherBB.h) / 2;
            const distance = Math.hypot(
              afterPos.x - otherPos.x,
              afterPos.y - otherPos.y
            );
            const minSeparation = nodeRadius + otherRadius + 20;

            if (distance < minSeparation) {
              overlaps.push({
                node1: nodeId,
                node2: otherId,
                distance,
                minRequired: minSeparation,
                overlap: minSeparation - distance,
                iteration: i
              });
            }
          }
        }
      });

      console.log(`Node ${nodeId}: ${linkedNodes.length} connections, position: (${afterPos.x.toFixed(0)}, ${afterPos.y.toFixed(0)})`);
    }

    // Analyze results
    const primaryEdges = edgeInfo.filter(e => e.isPrimary);
    const secondaryEdges = edgeInfo.filter(e => !e.isPrimary);

    const avgPrimaryDist = primaryEdges.length > 0
      ? primaryEdges.reduce((sum, e) => sum + e.distance, 0) / primaryEdges.length
      : 0;

    const avgSecondaryDist = secondaryEdges.length > 0
      ? secondaryEdges.reduce((sum, e) => sum + e.distance, 0) / secondaryEdges.length
      : 0;

    // Group overlaps by when they occurred
    const earlyOverlaps = overlaps.filter(o => o.iteration < 10);
    const midOverlaps = overlaps.filter(o => o.iteration >= 10 && o.iteration < 20);
    const lateOverlaps = overlaps.filter(o => o.iteration >= 20);

    return {
      totalNodes: 30,
      totalOverlaps: overlaps.length,
      earlyOverlaps: earlyOverlaps.length,
      midOverlaps: midOverlaps.length,
      lateOverlaps: lateOverlaps.length,
      avgPrimaryEdgeDistance: avgPrimaryDist,
      avgSecondaryEdgeDistance: avgSecondaryDist,
      primaryEdgeCount: primaryEdges.length,
      secondaryEdgeCount: secondaryEdges.length,
      worstOverlaps: overlaps.sort((a, b) => b.overlap - a.overlap).slice(0, 5)
    };
  });

  console.log('\n=== OVERLAP ANALYSIS ===');
  console.log(`Total overlaps: ${analysis.totalOverlaps}`);
  console.log(`  Early (nodes 0-9): ${analysis.earlyOverlaps}`);
  console.log(`  Middle (nodes 10-19): ${analysis.midOverlaps}`);
  console.log(`  Late (nodes 20-29): ${analysis.lateOverlaps}`);
  console.log(`\nEdge distances:`);
  console.log(`  Primary edges: ${analysis.avgPrimaryEdgeDistance.toFixed(1)}px (${analysis.primaryEdgeCount} edges)`);
  console.log(`  Secondary edges: ${analysis.avgSecondaryEdgeDistance.toFixed(1)}px (${analysis.secondaryEdgeCount} edges)`);
  console.log(`\nWorst overlaps:`);
  analysis.worstOverlaps.forEach(o => {
    console.log(`  ${o.node1} ↔ ${o.node2}: ${o.overlap.toFixed(1)}px overlap (distance: ${o.distance.toFixed(1)}px, needed: ${o.minRequired.toFixed(1)}px)`);
  });

  // Check positions visually
  await page.evaluate(() => {
    if (window.cy) {
      window.cy.fit(50);
    }
  });

  await page.screenshot({
    path: 'tests/screenshots/overlap-diagnostic-30-nodes.png',
    fullPage: true
  });

  // Test with different node sizes
  console.log('\n=== TESTING WITH DIFFERENT NODE SIZES ===');
  await page.evaluate(() => {
    window.cy.elements().remove();
  });

  const sizeTest = await page.evaluate(() => {
    // Add nodes with varying sizes
    const sizes = [40, 60, 80, 40, 100, 40];
    const positions = [];

    for (let i = 0; i < sizes.length; i++) {
      const nodeId = `size-${i}`;
      const parentId = i > 0 ? `size-${i - 1}` : null;

      const node = window.cy.add({
        group: 'nodes',
        data: {
          id: nodeId,
          label: `S${i}`,
          linkedNodeIds: parentId ? [parentId] : []
        },
        style: {
          width: sizes[i],
          height: sizes[i]
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

      window.layoutManager.positionNode(window.cy, nodeId, parentId);
      positions.push({
        id: nodeId,
        size: sizes[i],
        position: node.position()
      });
    }

    // Check distances
    const distances = [];
    for (let i = 1; i < positions.length; i++) {
      const dist = Math.hypot(
        positions[i].position.x - positions[i-1].position.x,
        positions[i].position.y - positions[i-1].position.y
      );
      distances.push({
        from: positions[i-1].id,
        to: positions[i].id,
        distance: dist,
        expectedMin: (positions[i-1].size + positions[i].size) / 2 + 20
      });
    }

    return distances;
  });

  console.log('Node size test - edge distances:');
  sizeTest.forEach(d => {
    const good = d.distance >= d.expectedMin;
    console.log(`  ${d.from} → ${d.to}: ${d.distance.toFixed(1)}px (min expected: ${d.expectedMin.toFixed(1)}px) ${good ? '✓' : '⚠️'}`);
  });

  // Assertions
  expect(analysis.totalOverlaps).toBeLessThanOrEqual(15); // Allow some overlaps in 30 nodes
  expect(analysis.avgPrimaryEdgeDistance).toBeGreaterThan(80);
  expect(analysis.avgPrimaryEdgeDistance).toBeLessThan(160);

  console.log('\n=== DIAGNOSTIC COMPLETE ===');
});