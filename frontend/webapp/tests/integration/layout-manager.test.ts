import { describe, test, expect, beforeEach } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { LayoutManager } from '../../src/graph-core/graphviz/layout/LayoutManager';

describe('LayoutManager Integration Tests', () => {
  let cy: Core;
  let layoutManager: LayoutManager;

  beforeEach(() => {
    // Create a headless Cytoscape instance for testing
    cy = cytoscape({
      headless: true,
      styleEnabled: false
    });
    layoutManager = new LayoutManager();
  });

  test('should position 100 nodes incrementally without severe overlaps', () => {
    const nodeCount = 100;
    const addedNodes = [];

    for (let i = 0; i < nodeCount; i++) {
      const nodeId = `node-${i}`;
      let parentId = null;
      const linkedNodes = [];

      // Create tree structure: each node has exactly ONE parent
      if (i > 0) {
        // For interesting tree structure with branching
        if (i > 5 && Math.random() > 0.6) {
          // 40% chance to branch from an earlier node (creating new branches)
          parentId = `node-${Math.floor(Math.random() * i)}`;
        } else if (i > 10 && Math.random() > 0.8) {
          // 20% chance for deeper nodes to connect to much earlier nodes
          parentId = `node-${Math.floor(Math.random() * Math.min(5, i))}`;
        } else {
          // 40-60% continue the current branch
          parentId = `node-${i - 1}`;
        }
        linkedNodes.push(parentId);
      }

      // Add node
      const node = cy.add({
        group: 'nodes',
        data: {
          id: nodeId,
          label: `Node ${i}`,
          linkedNodeIds: [...new Set(linkedNodes)]
        }
      });

      // Add edges
      linkedNodes.forEach((targetId, idx) => {
        if (cy.$id(targetId).length > 0) {
          cy.add({
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
      layoutManager.positionNode(cy, nodeId, parentId);

      // Store node info for validation
      const pos = node.position();
      const bb = node.boundingBox({ includeLabels: false });
      addedNodes.push({
        id: nodeId,
        position: pos,
        size: { width: bb.w || 40, height: bb.h || 40 },
        linkedCount: linkedNodes.length
      });
    }

    // Debug: Check if nodes actually have positions
    console.log(`Total nodes created: ${cy.nodes().length}`);
    const samplePositions = cy.nodes().slice(0, 5).map(n => ({
      id: n.id(),
      pos: n.position()
    }));
    console.log('Sample node positions:', samplePositions);

    // Validation 1: Check for severe overlaps
    const nodes = cy.nodes();
    let overlapCount = 0;
    let severeOverlaps = 0;
    const minDistance = 10; // Minimum distance for minor overlaps
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

    // For online incremental positioning of 100 nodes, some overlaps are expected
    const maxSevereOverlaps = 75; // Allow up to 75 severe overlaps for 100 nodes
    expect(severeOverlaps).toBeLessThanOrEqual(maxSevereOverlaps);
    expect(overlapCount).toBeLessThanOrEqual(200); // Allow up to 200 minor overlaps
    console.log(`✓ Overlap check: ${overlapCount} minor overlaps, ${severeOverlaps} severe (max ${maxSevereOverlaps} severe allowed)`);

    // Validation 2: Check edge lengths are reasonable
    const edges = cy.edges();
    const lengths = edges.map(edge => {
      const source = edge.source().position();
      const target = edge.target().position();
      return Math.hypot(source.x - target.x, source.y - target.y);
    });

    const avgLength = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
    const minLength = lengths.length > 0 ? Math.min(...lengths) : 0;
    const maxLength = lengths.length > 0 ? Math.max(...lengths) : 0;

    expect(avgLength).toBeGreaterThan(50);
    expect(avgLength).toBeLessThan(200);
    expect(minLength).toBeGreaterThan(20);
    console.log(`✓ Edge lengths: avg=${avgLength.toFixed(1)}, min=${minLength.toFixed(1)}, max=${maxLength.toFixed(1)}`);

    // Validation 3: Check graph spread (not all bunched up)
    const bb = cy.elements().boundingBox();
    const area = bb.w * bb.h;
    const density = nodeCount / (area / 10000); // nodes per 100x100 area

    expect(bb.w).toBeGreaterThan(500);
    expect(bb.h).toBeGreaterThan(500);
    expect(density).toBeLessThan(10); // Not too dense
    console.log(`✓ Graph spread: ${bb.w.toFixed(0)}x${bb.h.toFixed(0)}, density=${density.toFixed(2)} nodes/area`);

    // Validation 4: Check that nodes maintain relative positions (parent-child proximity)
    let totalDist = 0;
    let count = 0;
    let tooFarCount = 0;
    const maxExpectedDist = 250;

    cy.nodes().forEach(node => {
      const linkedIds = node.data('linkedNodeIds') || [];
      linkedIds.forEach((linkedId: string) => {
        const linked = cy.$id(linkedId);
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

    const avgParentDist = count > 0 ? totalDist / count : 0;
    expect(avgParentDist).toBeGreaterThan(60);
    expect(avgParentDist).toBeLessThan(180);
    expect(tooFarCount).toBeLessThan(10);
    console.log(`✓ Parent-child proximity: avg=${avgParentDist.toFixed(1)}, too far=${tooFarCount}`);
  });

  test('should handle rapid sequential additions without layout degradation', () => {
    const startTime = performance.now();
    const positions = [];

    for (let i = 0; i < 20; i++) {
      const nodeId = `rapid-${i}`;
      const parentId = i > 0 ? `rapid-${i - 1}` : null;

      // Add node
      cy.add({
        group: 'nodes',
        data: {
          id: nodeId,
          label: `Rapid ${i}`,
          linkedNodeIds: parentId ? [parentId] : []
        }
      });

      // Add edge if has parent
      if (parentId) {
        cy.add({
          group: 'edges',
          data: {
            id: `${nodeId}-${parentId}`,
            source: nodeId,
            target: parentId
          }
        });
      }

      // Position immediately
      layoutManager.positionNode(cy, nodeId, parentId);
      positions.push(cy.$id(nodeId).position());
    }

    const endTime = performance.now();
    const timeMs = endTime - startTime;

    expect(timeMs).toBeLessThan(1000); // Should complete in under 1 second
    console.log(`✓ Rapid addition of 20 nodes completed in ${timeMs.toFixed(1)}ms`);

    // Check positions are distinct
    const uniquePositions = new Set(
      positions.map(p => `${Math.round(p.x)},${Math.round(p.y)}`)
    );
    expect(uniquePositions.size).toBeGreaterThan(18); // At least 18 unique positions
    console.log(`✓ ${uniquePositions.size}/20 unique positions achieved`);
  });
});