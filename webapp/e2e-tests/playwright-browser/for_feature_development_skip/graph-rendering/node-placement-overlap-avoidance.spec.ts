/**
 * Browser-based E2E test: Node placement avoids overlaps
 *
 * Tests that the collision-aware positioning algorithm produces non-overlapping
 * node placements when multiple children are created from a parent node.
 *
 * Validates the full flow: obstacle extraction from cytoscape → collision-aware
 * positioning → graph delta application → cytoscape rendering.
 *
 * This test works with both the current linear-scan obstacle detection and
 * will validate the spatial index (R-tree via rbush) once integrated.
 */

import { expect } from '@playwright/test';
import { sendGraphDelta } from '@e2e/playwright-browser/graph-delta-test-utils';
import { test } from './node-placement-overlap-avoidance/testFixture';
import {
  type ChildEdge,
  createChildAndParentDelta,
  createParentDelta
} from './node-placement-overlap-avoidance/graphDeltaHelpers';
import {
  assertNoOverlaps,
  createTargetSizedBBoxes,
  getAllNodeBBoxes
} from './node-placement-overlap-avoidance/placementAssertions';
import {
  calculateCollisionFreeChildPosition,
  fitGraphToView,
  setupGraphView,
  waitForNodeCount
} from './node-placement-overlap-avoidance/placementFlow';

test.describe('Node Placement: Overlap Avoidance', () => {

  test('8 children from a single parent should not overlap', async ({ page, consoleCapture: _ }) => {
    console.log('\n=== Starting node placement overlap avoidance test ===');

    // Step 1: Setup app
    console.log('=== Step 1: Setup mock Electron API ===');
    await setupGraphView(page);
    console.log('OK Graph view ready');

    const parentId = 'root-parent.md';
    const parentPos = { x: 500, y: 500 };

    // Step 2: Create parent node
    console.log('=== Step 2: Create parent node ===');
    await sendGraphDelta(page, createParentDelta(parentId, parentPos));
    await waitForNodeCount(page, 1);
    console.log('OK Parent node created');

    // Step 3: Create 8 child nodes, each positioned by the collision-aware algorithm
    console.log('=== Step 3: Create 8 children using collision-aware positioning ===');
    const childCount = 8;
    const childEdges: ChildEdge[] = [];

    for (let i = 0; i < childCount; i++) {
      const childId = `root-parent_${i}.md`;

      const position = await calculateCollisionFreeChildPosition(page, parentId, i);

      console.log(`  Child ${i}: positioned at (${position.x.toFixed(0)}, ${position.y.toFixed(0)})`);

      // Track edges for parent update
      childEdges.push({ targetId: childId, label: '' });

      // Send child node delta + updated parent with new edge
      await sendGraphDelta(page, createChildAndParentDelta({
        childId,
        childContent: `# Child ${i}\nChild node number ${i}.`,
        childPosition: position,
        parentId,
        parentContent: '# Root Node\nThe root of the test tree.',
        parentPosition: parentPos,
        childEdges,
      }));

      // Wait for the child to appear in cytoscape
      const expectedCount = i + 2; // parent + children so far
      await waitForNodeCount(page, expectedCount);
    }

    console.log('OK All children created');

    // Step 4: Allow brief settle for layout events / size updates
    await page.waitForTimeout(200);

    // Step 5: Extract all node bounding boxes
    console.log('=== Step 4: Extract and verify node positions ===');
    const bboxes = await getAllNodeBBoxes(page);
    console.log(`Total nodes in graph: ${bboxes.length}`);
    bboxes.forEach(bbox => {
      console.log(`  ${bbox.id}: [${bbox.x1.toFixed(0)},${bbox.y1.toFixed(0)} -> ${bbox.x2.toFixed(0)},${bbox.y2.toFixed(0)}] (${bbox.width.toFixed(0)}x${bbox.height.toFixed(0)})`);
    });

    // Step 6: Verify expected node count
    expect(bboxes.length).toBe(childCount + 1); // parent + children

    // Step 7: Verify no overlaps among ALL nodes (parent + children)
    assertNoOverlaps(bboxes);

    console.log('OK No overlapping nodes detected');
  });

  test('positions calculated by findBestPosition should not overlap with 250x250 target boxes', async ({ page, consoleCapture: _ }) => {
    console.log('\n=== Starting positioning algorithm overlap test ===');

    // Setup app
    await setupGraphView(page);

    const parentId = 'algo-parent.md';
    const parentPos = { x: 500, y: 500 };

    // Create parent node
    await sendGraphDelta(page, createParentDelta(parentId, parentPos));
    await waitForNodeCount(page, 1);

    // Create 8 children and collect their positions
    const childCount = 8;
    const positions: { x: number; y: number }[] = [parentPos]; // include parent
    const childEdges: ChildEdge[] = [];

    for (let i = 0; i < childCount; i++) {
      const childId = `algo-parent_${i}.md`;

      const position = await calculateCollisionFreeChildPosition(page, parentId, i);

      positions.push(position);
      childEdges.push({ targetId: childId, label: '' });

      // Send delta to keep cytoscape in sync for next iteration's obstacle extraction
      await sendGraphDelta(page, createChildAndParentDelta({
        childId,
        childContent: `# Child ${i}`,
        childPosition: position,
        parentId,
        parentContent: '# Root Node',
        parentPosition: parentPos,
        childEdges,
      }));

      await waitForNodeCount(page, i + 2);
    }

    // Verify no overlaps using the 250x250 target dimensions
    // (the same dimensions the algorithm used to avoid collisions)
    const TARGET_SIZE = 250;
    const algorithmBBoxes = createTargetSizedBBoxes(positions, parentId, 'algo-parent', TARGET_SIZE);

    console.log('Positions with 250x250 bounding boxes:');
    algorithmBBoxes.forEach(bbox => {
      console.log(`  ${bbox.id}: center=(${(bbox.x1 + bbox.x2) / 2}, ${(bbox.y1 + bbox.y2) / 2}) box=[${bbox.x1},${bbox.y1} -> ${bbox.x2},${bbox.y2}]`);
    });

    assertNoOverlaps(algorithmBBoxes);
    console.log('OK No overlapping 250x250 bounding boxes detected');
  });

  test('screenshot: visual verification of node placement spread', async ({ page, consoleCapture: _ }) => {
    console.log('\n=== Starting visual node placement test ===');

    await setupGraphView(page);

    const parentId = 'visual-root.md';
    const parentPos = { x: 500, y: 500 };

    // Create parent
    await sendGraphDelta(page, createParentDelta(parentId, parentPos));
    await waitForNodeCount(page, 1);

    // Create 8 children using collision-aware positioning
    const childEdges: ChildEdge[] = [];
    for (let i = 0; i < 8; i++) {
      const childId = `visual-root_${i}.md`;

      const position = await calculateCollisionFreeChildPosition(page, parentId, i);

      childEdges.push({ targetId: childId, label: '' });

      await sendGraphDelta(page, createChildAndParentDelta({
        childId,
        childContent: `# Topic ${i}\nContent for topic ${i}.`,
        childPosition: position,
        parentId,
        parentContent: '# Visual Root\nRoot node for visual test.',
        parentPosition: parentPos,
        childEdges,
      }));

      await waitForNodeCount(page, i + 2);
    }

    // Fit all nodes in view for screenshot
    await fitGraphToView(page);
    await page.waitForTimeout(300);

    // Take screenshot for visual verification
    await page.screenshot({
      path: 'e2e-tests/screenshots/node-placement-overlap-avoidance.png',
      fullPage: true
    });
    console.log('OK Screenshot taken: node-placement-overlap-avoidance.png');

    // Also verify no overlaps programmatically
    const bboxes = await getAllNodeBBoxes(page);
    expect(bboxes.length).toBe(9); // 1 parent + 8 children
    assertNoOverlaps(bboxes);
    console.log('OK Visual test passed with no overlaps');
  });
});
