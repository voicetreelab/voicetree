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

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

// Console capture fixture (same pattern as other tests)
type ConsoleCapture = {
  consoleLogs: string[];
  pageErrors: string[];
  testLogs: string[];
};

const test = base.extend<{ consoleCapture: ConsoleCapture }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const testLogs: string[] = [];

    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    console.log = originalLog;

    if (testInfo.status !== 'passed') {
      console.log('\n=== Test Logs ===');
      testLogs.forEach(log => console.log(log));
      console.log('\n=== Browser Console Logs ===');
      consoleLogs.forEach(log => console.log(log));
      if (pageErrors.length > 0) {
        console.log('\n=== Browser Errors ===');
        pageErrors.forEach(err => console.log(err));
      }
    }
  }
});

interface NodeBBox {
  readonly id: string;
  readonly x1: number;
  readonly x2: number;
  readonly y1: number;
  readonly y2: number;
  readonly width: number;
  readonly height: number;
}

/**
 * AABB overlap check between two bounding boxes.
 */
function rectsOverlap(a: NodeBBox, b: NodeBBox): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/**
 * Create a parent node GraphDelta at the given position.
 */
function createParentDelta(parentId: string, pos: { x: number; y: number }): GraphDelta {
  return [
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: parentId,
        contentWithoutYamlOrLinks: '# Root Node\nThe root of the test tree.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: pos } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false,
        }
      },
      previousNode: { _tag: 'None' } as const
    }
  ];
}

/**
 * Get all node bounding boxes from cytoscape.
 */
async function getAllNodeBBoxes(page: import('@playwright/test').Page): Promise<NodeBBox[]> {
  return page.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return [];
    return cy.nodes().map((node) => {
      const pos = node.position();
      const w = node.width();
      const h = node.height();
      return {
        id: node.id(),
        x1: pos.x - w / 2,
        x2: pos.x + w / 2,
        y1: pos.y - h / 2,
        y2: pos.y + h / 2,
        width: w,
        height: h,
      };
    });
  });
}

/**
 * Assert that no two node bounding boxes overlap.
 * Logs all node positions for debugging on failure.
 */
function assertNoOverlaps(bboxes: NodeBBox[]): void {
  const overlaps: string[] = [];
  for (let i = 0; i < bboxes.length; i++) {
    for (let j = i + 1; j < bboxes.length; j++) {
      const a = bboxes[i];
      const b = bboxes[j];
      if (rectsOverlap(a, b)) {
        overlaps.push(
          `"${a.id}" [${a.x1.toFixed(0)},${a.y1.toFixed(0)} → ${a.x2.toFixed(0)},${a.y2.toFixed(0)}] ∩ ` +
          `"${b.id}" [${b.x1.toFixed(0)},${b.y1.toFixed(0)} → ${b.x2.toFixed(0)},${b.y2.toFixed(0)}]`
        );
      }
    }
  }
  expect(overlaps, `Found ${overlaps.length} overlapping node pairs:\n${overlaps.join('\n')}`).toHaveLength(0);
}

test.describe('Node Placement: Overlap Avoidance', () => {

  test('8 children from a single parent should not overlap', async ({ page, consoleCapture: _ }) => {
    console.log('\n=== Starting node placement overlap avoidance test ===');

    // Step 1: Setup app
    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await waitForCytoscapeReady(page);
    console.log('OK Graph view ready');

    const parentId = 'root-parent.md';
    const parentPos = { x: 500, y: 500 };

    // Step 2: Create parent node
    console.log('=== Step 2: Create parent node ===');
    await sendGraphDelta(page, createParentDelta(parentId, parentPos));
    await page.waitForFunction(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy && cy.nodes().length >= 1;
    }, { timeout: 5000 });
    console.log('OK Parent node created');

    // Step 3: Create 8 child nodes, each positioned by the collision-aware algorithm
    console.log('=== Step 3: Create 8 children using collision-aware positioning ===');
    const childCount = 8;
    const childEdges: { targetId: string; label: string }[] = [];

    for (let i = 0; i < childCount; i++) {
      const childId = `root-parent_${i}.md`;

      // Calculate collision-free position using the app's own positioning functions
      // imported dynamically via Vite dev server in the browser context
      const position = await page.evaluate(async (args: { parentId: string; childIndex: number }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obstacleModule = await import('/src/shell/edge/UI-edge/floating-windows/extractObstaclesFromCytoscape.ts' as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const positionModule = await import('/src/pure/graph/positioning/findBestPosition.ts' as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const angularModule = await import('/src/pure/graph/positioning/angularPositionSeeding.ts' as any);

        const { extractObstaclesFromCytoscape, extractEdgeSegmentsFromCytoscape } = obstacleModule;
        const { findBestPosition } = positionModule;
        const { calculateChildAngle, DEFAULT_EDGE_LENGTH } = angularModule;

        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape instance not available');

        const parentNode = cy.getElementById(args.parentId);
        if (parentNode.length === 0) throw new Error(`Parent node ${args.parentId} not found`);

        const parentPos = parentNode.position();
        const obstacles = extractObstaclesFromCytoscape(cy, args.parentId);
        const edgeSegments = extractEdgeSegmentsFromCytoscape(cy, args.parentId);
        const desiredAngle = calculateChildAngle(args.childIndex, undefined);

        // Use the same target dimensions as calculateInitialPosition.ts
        const CHILD_NODE_DIMENSIONS = { width: 250, height: 250 };

        return findBestPosition(
          parentPos,
          desiredAngle,
          DEFAULT_EDGE_LENGTH,
          CHILD_NODE_DIMENSIONS,
          obstacles,
          undefined,
          edgeSegments
        );
      }, { parentId, childIndex: i });

      console.log(`  Child ${i}: positioned at (${position.x.toFixed(0)}, ${position.y.toFixed(0)})`);

      // Track edges for parent update
      childEdges.push({ targetId: childId, label: '' });

      // Send child node delta + updated parent with new edge
      const delta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: childId,
            contentWithoutYamlOrLinks: `# Child ${i}\nChild node number ${i}.`,
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: position } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false,
            }
          },
          previousNode: { _tag: 'None' } as const
        },
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: parentId,
            contentWithoutYamlOrLinks: '# Root Node\nThe root of the test tree.',
            outgoingEdges: [...childEdges],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: parentPos } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false,
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];

      await sendGraphDelta(page, delta);

      // Wait for the child to appear in cytoscape
      const expectedCount = i + 2; // parent + children so far
      await page.waitForFunction((count: number) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy && cy.nodes().length >= count;
      }, expectedCount, { timeout: 5000 });
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
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await waitForCytoscapeReady(page);

    const parentId = 'algo-parent.md';
    const parentPos = { x: 500, y: 500 };

    // Create parent node
    await sendGraphDelta(page, createParentDelta(parentId, parentPos));
    await page.waitForFunction(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy && cy.nodes().length >= 1;
    }, { timeout: 5000 });

    // Create 8 children and collect their positions
    const childCount = 8;
    const positions: { x: number; y: number }[] = [parentPos]; // include parent
    const childEdges: { targetId: string; label: string }[] = [];

    for (let i = 0; i < childCount; i++) {
      const childId = `algo-parent_${i}.md`;

      const position = await page.evaluate(async (args: { parentId: string; childIndex: number }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obstacleModule = await import('/src/shell/edge/UI-edge/floating-windows/extractObstaclesFromCytoscape.ts' as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const positionModule = await import('/src/pure/graph/positioning/findBestPosition.ts' as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const angularModule = await import('/src/pure/graph/positioning/angularPositionSeeding.ts' as any);

        const { extractObstaclesFromCytoscape, extractEdgeSegmentsFromCytoscape } = obstacleModule;
        const { findBestPosition } = positionModule;
        const { calculateChildAngle, DEFAULT_EDGE_LENGTH } = angularModule;

        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape instance not available');

        const parentNode = cy.getElementById(args.parentId);
        const parentPos = parentNode.position();
        const obstacles = extractObstaclesFromCytoscape(cy, args.parentId);
        const edgeSegments = extractEdgeSegmentsFromCytoscape(cy, args.parentId);
        const desiredAngle = calculateChildAngle(args.childIndex, undefined);

        return findBestPosition(
          parentPos,
          desiredAngle,
          DEFAULT_EDGE_LENGTH,
          { width: 250, height: 250 },
          obstacles,
          undefined,
          edgeSegments
        );
      }, { parentId, childIndex: i });

      positions.push(position);
      childEdges.push({ targetId: childId, label: '' });

      // Send delta to keep cytoscape in sync for next iteration's obstacle extraction
      await sendGraphDelta(page, [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: childId,
            contentWithoutYamlOrLinks: `# Child ${i}`,
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: position } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false,
            }
          },
          previousNode: { _tag: 'None' } as const
        },
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: parentId,
            contentWithoutYamlOrLinks: '# Root Node',
            outgoingEdges: [...childEdges],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: parentPos } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false,
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ]);

      await page.waitForFunction((count: number) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy && cy.nodes().length >= count;
      }, i + 2, { timeout: 5000 });
    }

    // Verify no overlaps using the 250x250 target dimensions
    // (the same dimensions the algorithm used to avoid collisions)
    const TARGET_SIZE = 250;
    const algorithmBBoxes: NodeBBox[] = positions.map((pos, i) => ({
      id: i === 0 ? parentId : `algo-parent_${i - 1}.md`,
      x1: pos.x - TARGET_SIZE / 2,
      x2: pos.x + TARGET_SIZE / 2,
      y1: pos.y - TARGET_SIZE / 2,
      y2: pos.y + TARGET_SIZE / 2,
      width: TARGET_SIZE,
      height: TARGET_SIZE,
    }));

    console.log('Positions with 250x250 bounding boxes:');
    algorithmBBoxes.forEach(bbox => {
      console.log(`  ${bbox.id}: center=(${(bbox.x1 + bbox.x2) / 2}, ${(bbox.y1 + bbox.y2) / 2}) box=[${bbox.x1},${bbox.y1} -> ${bbox.x2},${bbox.y2}]`);
    });

    assertNoOverlaps(algorithmBBoxes);
    console.log('OK No overlapping 250x250 bounding boxes detected');
  });

  test('screenshot: visual verification of node placement spread', async ({ page, consoleCapture: _ }) => {
    console.log('\n=== Starting visual node placement test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await waitForCytoscapeReady(page);

    const parentId = 'visual-root.md';
    const parentPos = { x: 500, y: 500 };

    // Create parent
    await sendGraphDelta(page, createParentDelta(parentId, parentPos));
    await page.waitForFunction(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy && cy.nodes().length >= 1;
    }, { timeout: 5000 });

    // Create 8 children using collision-aware positioning
    const childEdges: { targetId: string; label: string }[] = [];
    for (let i = 0; i < 8; i++) {
      const childId = `visual-root_${i}.md`;

      const position = await page.evaluate(async (args: { parentId: string; childIndex: number }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obstacleModule = await import('/src/shell/edge/UI-edge/floating-windows/extractObstaclesFromCytoscape.ts' as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const positionModule = await import('/src/pure/graph/positioning/findBestPosition.ts' as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const angularModule = await import('/src/pure/graph/positioning/angularPositionSeeding.ts' as any);

        const { extractObstaclesFromCytoscape, extractEdgeSegmentsFromCytoscape } = obstacleModule;
        const { findBestPosition } = positionModule;
        const { calculateChildAngle, DEFAULT_EDGE_LENGTH } = angularModule;

        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape instance not available');

        const parentNode = cy.getElementById(args.parentId);
        const parentPos = parentNode.position();
        const obstacles = extractObstaclesFromCytoscape(cy, args.parentId);
        const edgeSegments = extractEdgeSegmentsFromCytoscape(cy, args.parentId);
        const desiredAngle = calculateChildAngle(args.childIndex, undefined);

        return findBestPosition(
          parentPos,
          desiredAngle,
          DEFAULT_EDGE_LENGTH,
          { width: 250, height: 250 },
          obstacles,
          undefined,
          edgeSegments
        );
      }, { parentId, childIndex: i });

      childEdges.push({ targetId: childId, label: '' });

      await sendGraphDelta(page, [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: childId,
            contentWithoutYamlOrLinks: `# Topic ${i}\nContent for topic ${i}.`,
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: position } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false,
            }
          },
          previousNode: { _tag: 'None' } as const
        },
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: parentId,
            contentWithoutYamlOrLinks: '# Visual Root\nRoot node for visual test.',
            outgoingEdges: [...childEdges],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: parentPos } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false,
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ]);

      await page.waitForFunction((count: number) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy && cy.nodes().length >= count;
      }, i + 2, { timeout: 5000 });
    }

    // Fit all nodes in view for screenshot
    await page.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (cy) cy.fit(undefined, 50);
    });
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
