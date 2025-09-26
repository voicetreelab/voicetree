import { test, expect } from '@playwright/test';

test.describe('Positioning Algorithm Diagnostics', () => {
  test('diagnose positioning algorithm behavior', async ({ page }) => {
    await page.goto('/graph-test.html');
    await page.waitForSelector('#graph-container canvas', { timeout: 5000 });

    // Clear existing graph
    await page.evaluate(() => {
      if (!window.cy) throw new Error('Cytoscape not initialized');
      window.cy.elements().remove();
    });

    console.log('=== POSITIONING ALGORITHM DIAGNOSTICS ===');

    // Test 1: Simple chain - each node connects to previous
    console.log('\n--- Test 1: Simple Chain (10 nodes) ---');
    const chainResults = await page.evaluate(() => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      const results = {
        nodes: [] as any[],
        edgeDistances: [] as number[],
        positionChanges: [] as any[]
      };

      // Add 10 nodes in a chain
      for (let i = 0; i < 10; i++) {
        const nodeId = `chain-${i}`;
        const parentId = i > 0 ? `chain-${i - 1}` : null;

        // Track position before adding
        const beforePositions = new Map();
        window.cy.nodes().forEach((n: any) => {
          beforePositions.set(n.id(), n.position());
        });

        // Add node
        const node = window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Chain ${i}`,
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

        // Get initial position (should be at origin or random)
        const initialPos = { ...node.position() };

        // Position using LayoutManager
        window.layoutManager.positionNode(window.cy, nodeId, parentId);

        // Get final position
        const finalPos = node.position();

        // Calculate distance moved
        const distanceMoved = Math.hypot(
          finalPos.x - initialPos.x,
          finalPos.y - initialPos.y
        );

        // If has parent, calculate edge distance
        let edgeDistance = null;
        if (parentId) {
          const parent = window.cy.$id(parentId);
          const parentPos = parent.position();
          edgeDistance = Math.hypot(
            finalPos.x - parentPos.x,
            finalPos.y - parentPos.y
          );
          results.edgeDistances.push(edgeDistance);
        }

        // Check if any existing nodes moved
        const movedNodes = [];
        beforePositions.forEach((oldPos, id) => {
          const node = window.cy.$id(id);
          if (node.length > 0) {
            const newPos = node.position();
            const moved = Math.hypot(newPos.x - oldPos.x, newPos.y - oldPos.y);
            if (moved > 0.1) {
              movedNodes.push({ id, distance: moved });
            }
          }
        });

        results.nodes.push({
          id: nodeId,
          parentId,
          initialPos,
          finalPos,
          distanceMoved,
          edgeDistance,
          iteration: i
        });

        if (movedNodes.length > 0) {
          results.positionChanges.push({
            addedNode: nodeId,
            movedNodes
          });
        }
      }

      return results;
    });

    // Analyze chain results
    console.log('Chain positioning results:');
    chainResults.nodes.forEach(node => {
      console.log(`  Node ${node.id}:`);
      console.log(`    - Moved: ${node.distanceMoved.toFixed(1)}px`);
      if (node.edgeDistance !== null) {
        console.log(`    - Edge distance to parent: ${node.edgeDistance.toFixed(1)}px`);
      }
      console.log(`    - Final position: (${node.finalPos.x.toFixed(0)}, ${node.finalPos.y.toFixed(0)})`);
    });

    // Check if nodes actually moved from initial positions
    const nodesDidntMove = chainResults.nodes.filter(n => n.distanceMoved < 1);
    if (nodesDidntMove.length > 0) {
      console.log(`  ⚠️ WARNING: ${nodesDidntMove.length} nodes didn't move from initial position!`);
      console.log(`    Nodes: ${nodesDidntMove.map(n => n.id).join(', ')}`);
    }

    // Check if existing nodes moved (they shouldn't in online positioning)
    if (chainResults.positionChanges.length > 0) {
      console.log(`  ⚠️ WARNING: Existing nodes moved when adding new nodes!`);
      chainResults.positionChanges.forEach(change => {
        console.log(`    When adding ${change.addedNode}: ${change.movedNodes.length} nodes moved`);
      });
    }

    // Check edge distances
    if (chainResults.edgeDistances.length > 0) {
      const avgEdgeDist = chainResults.edgeDistances.reduce((a, b) => a + b, 0) / chainResults.edgeDistances.length;
      const minEdgeDist = Math.min(...chainResults.edgeDistances);
      const maxEdgeDist = Math.max(...chainResults.edgeDistances);
      console.log(`  Edge distances: avg=${avgEdgeDist.toFixed(1)}, min=${minEdgeDist.toFixed(1)}, max=${maxEdgeDist.toFixed(1)}`);

      // Check if edge distances are close to target (120)
      const TARGET = 120;
      const farFromTarget = chainResults.edgeDistances.filter(d => Math.abs(d - TARGET) > 30);
      if (farFromTarget.length > 0) {
        console.log(`  ⚠️ WARNING: ${farFromTarget.length}/${chainResults.edgeDistances.length} edges are >30px from target distance (${TARGET}px)`);
      }
    }

    // Clear for next test
    await page.evaluate(() => window.cy.elements().remove());

    // Test 2: Star topology - all nodes connect to center
    console.log('\n--- Test 2: Star Topology (1 center + 8 leaves) ---');
    const starResults = await page.evaluate(() => {
      if (!window.cy || !window.layoutManager) {
        throw new Error('Required objects not available');
      }

      const results = {
        centerPos: null as any,
        leafPositions: [] as any[],
        overlaps: 0,
        angles: [] as number[]
      };

      // Add center node
      const center = window.cy.add({
        group: 'nodes',
        data: {
          id: 'center',
          label: 'Center',
          linkedNodeIds: []
        }
      });

      // Position center
      window.layoutManager.positionNode(window.cy, 'center');
      results.centerPos = center.position();

      // Add 8 leaf nodes
      for (let i = 0; i < 8; i++) {
        const leafId = `leaf-${i}`;

        const leaf = window.cy.add({
          group: 'nodes',
          data: {
            id: leafId,
            label: `Leaf ${i}`,
            linkedNodeIds: ['center']
          }
        });

        window.cy.add({
          group: 'edges',
          data: {
            id: `${leafId}-center`,
            source: leafId,
            target: 'center'
          }
        });

        window.layoutManager.positionNode(window.cy, leafId, 'center');

        const leafPos = leaf.position();
        const angle = Math.atan2(
          leafPos.y - results.centerPos.y,
          leafPos.x - results.centerPos.x
        );
        const distance = Math.hypot(
          leafPos.x - results.centerPos.x,
          leafPos.y - results.centerPos.y
        );

        results.leafPositions.push({
          id: leafId,
          position: leafPos,
          angle: angle * 180 / Math.PI,
          distance
        });
        results.angles.push(angle);
      }

      // Check for overlaps between leaves
      for (let i = 0; i < results.leafPositions.length; i++) {
        for (let j = i + 1; j < results.leafPositions.length; j++) {
          const p1 = results.leafPositions[i].position;
          const p2 = results.leafPositions[j].position;
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (dist < 50) { // Assuming node size ~40px
            results.overlaps++;
          }
        }
      }

      return results;
    });

    console.log('Star topology results:');
    console.log(`  Center at: (${starResults.centerPos.x.toFixed(0)}, ${starResults.centerPos.y.toFixed(0)})`);

    // Check angular distribution
    starResults.angles.sort((a, b) => a - b);
    const angleDiffs = [];
    for (let i = 0; i < starResults.angles.length; i++) {
      const next = (i + 1) % starResults.angles.length;
      let diff = starResults.angles[next] - starResults.angles[i];
      if (diff < 0) diff += 2 * Math.PI;
      angleDiffs.push(diff * 180 / Math.PI);
    }
    const minAngleDiff = Math.min(...angleDiffs);
    const maxAngleDiff = Math.max(...angleDiffs);

    console.log(`  Angle distribution: min gap=${minAngleDiff.toFixed(1)}°, max gap=${maxAngleDiff.toFixed(1)}°`);

    if (minAngleDiff < 20) {
      console.log(`  ⚠️ WARNING: Nodes too close angularly (min gap < 20°)`);
    }

    starResults.leafPositions.forEach(leaf => {
      console.log(`  ${leaf.id}: angle=${leaf.angle.toFixed(1)}°, distance=${leaf.distance.toFixed(1)}px`);
    });

    if (starResults.overlaps > 0) {
      console.log(`  ⚠️ WARNING: ${starResults.overlaps} overlapping leaf pairs detected!`);
    }

    // Clear for next test
    await page.evaluate(() => window.cy.elements().remove());

    // Test 3: Check if positioning is deterministic
    console.log('\n--- Test 3: Determinism Check ---');
    const deterministicResults = await page.evaluate(async () => {
      const results = {
        run1: [] as any[],
        run2: [] as any[],
        isDeterministic: true
      };

      // Run 1
      for (let i = 0; i < 5; i++) {
        const nodeId = `det-${i}`;
        const parentId = i > 0 ? `det-${i - 1}` : null;

        window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Det ${i}`,
            linkedNodeIds: parentId ? [parentId] : []
          }
        });

        if (parentId) {
          window.cy.add({
            group: 'edges',
            data: {
              id: `${nodeId}-${parentId}-1`,
              source: nodeId,
              target: parentId
            }
          });
        }

        window.layoutManager.positionNode(window.cy, nodeId, parentId);
        results.run1.push({
          id: nodeId,
          pos: window.cy.$id(nodeId).position()
        });
      }

      // Clear and run again
      window.cy.elements().remove();

      // Run 2
      for (let i = 0; i < 5; i++) {
        const nodeId = `det-${i}`;
        const parentId = i > 0 ? `det-${i - 1}` : null;

        window.cy.add({
          group: 'nodes',
          data: {
            id: nodeId,
            label: `Det ${i}`,
            linkedNodeIds: parentId ? [parentId] : []
          }
        });

        if (parentId) {
          window.cy.add({
            group: 'edges',
            data: {
              id: `${nodeId}-${parentId}-2`,
              source: nodeId,
              target: parentId
            }
          });
        }

        window.layoutManager.positionNode(window.cy, nodeId, parentId);
        results.run2.push({
          id: nodeId,
          pos: window.cy.$id(nodeId).position()
        });
      }

      // Compare positions
      for (let i = 0; i < results.run1.length; i++) {
        const p1 = results.run1[i].pos;
        const p2 = results.run2[i].pos;
        const diff = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (diff > 0.1) {
          results.isDeterministic = false;
          console.log(`Node ${results.run1[i].id} positioned differently: (${p1.x.toFixed(1)}, ${p1.y.toFixed(1)}) vs (${p2.x.toFixed(1)}, ${p2.y.toFixed(1)})`);
        }
      }

      return results;
    });

    if (deterministicResults.isDeterministic) {
      console.log('  ✓ Positioning is deterministic');
    } else {
      console.log('  ⚠️ WARNING: Positioning is NOT deterministic!');
    }

    // Test 4: Check if LayoutManager is actually being called
    console.log('\n--- Test 4: LayoutManager Integration Check ---');
    const integrationCheck = await page.evaluate(() => {
      // Try to access the strategy directly
      const hasLayoutManager = !!window.layoutManager;
      const strategyName = window.layoutManager?.strategy?.name || 'unknown';

      // Check if the seed-park-relax strategy is loaded
      const hasSeedParkRelax = !!window.SeedParkRelaxStrategy;

      // Try to call position method directly
      let canCallPosition = false;
      try {
        const testContext = {
          nodes: [],
          newNodes: [{
            id: 'test',
            position: { x: 0, y: 0 },
            size: { width: 40, height: 40 },
            linkedNodeIds: []
          }]
        };
        const result = window.layoutManager?.strategy?.position(testContext);
        canCallPosition = !!result && result.positions instanceof Map;
      } catch (e) {
        console.log('Error calling position:', e);
      }

      return {
        hasLayoutManager,
        strategyName,
        hasSeedParkRelax,
        canCallPosition
      };
    });

    console.log(`  LayoutManager present: ${integrationCheck.hasLayoutManager}`);
    console.log(`  Strategy: ${integrationCheck.strategyName}`);
    console.log(`  SeedParkRelaxStrategy available: ${integrationCheck.hasSeedParkRelax}`);
    console.log(`  Can call position(): ${integrationCheck.canCallPosition}`);

    // Assertions
    expect(integrationCheck.hasLayoutManager).toBe(true);
    expect(integrationCheck.strategyName).toBe('seed-park-relax');
    expect(integrationCheck.canCallPosition).toBe(true);

    // Check that nodes actually move
    expect(chainResults.nodes.filter(n => n.distanceMoved > 1).length).toBeGreaterThan(8);

    // Check that edge distances are reasonable (within 50% of target)
    const TARGET = 120;
    const edgesNearTarget = chainResults.edgeDistances.filter(d => d > TARGET * 0.5 && d < TARGET * 1.5);
    expect(edgesNearTarget.length).toBeGreaterThanOrEqual(chainResults.edgeDistances.length * 0.8);

    // Check that star topology doesn't have too many overlaps
    expect(starResults.overlaps).toBeLessThanOrEqual(2);

    // Check determinism
    expect(deterministicResults.isDeterministic).toBe(true);

    console.log('\n=== DIAGNOSTIC COMPLETE ===');
  });
});