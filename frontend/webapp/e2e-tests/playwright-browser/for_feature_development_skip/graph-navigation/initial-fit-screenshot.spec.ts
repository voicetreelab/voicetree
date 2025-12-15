/**
 * Visual test for initial graph fit with cyFitCollectionByAverageNodeSize
 * Screenshots the viewport after first and second node creation
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  getNodeCount,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
import type { GraphDelta } from '@/pure/graph';

function createSingleNodeDelta(id: string, title: string, x: number, y: number): GraphDelta {
  return [{
    type: 'UpsertNode' as const,
    nodeToUpsert: {
      relativeFilePathIsID: id,
      contentWithoutYamlOrLinks: `# ${title}\nContent for ${title} node.`,
      outgoingEdges: [],
      nodeUIMetadata: {
        color: { _tag: 'None' } as const,
        position: { _tag: 'Some', value: { x, y } } as const,
        additionalYAMLProps: new Map(),
        isContextNode: false
      }
    },
    previousNode: { _tag: 'None' } as const
  }];
}

test.describe('Initial Fit Visual Test', () => {
  test('screenshot after first and second node creation', async ({ page }) => {
    // Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Send first node
    const firstNodeDelta = createSingleNodeDelta('node-1.md', 'First Node', 0, 0);
    await sendGraphDelta(page, firstNodeDelta);

    let nodeCount = await getNodeCount(page);
    expect(nodeCount).toBe(1);

    // Wait for fit animation to complete (150ms delay + 300ms animation)
    await page.waitForTimeout(500);

    // Take screenshot after first node
    await page.screenshot({
      path: 'e2e-tests/screenshots/initial-fit-after-first-node.png',
      fullPage: false
    });

    // Log viewport info
    let viewportInfo = await page.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return null;
      return {
        zoom: cy.zoom(),
        pan: cy.pan(),
        nodeCount: cy.nodes().length
      };
    });
    console.log('Viewport after first node:', JSON.stringify(viewportInfo, null, 2));
    console.log('✓ Screenshot saved to e2e-tests/screenshots/initial-fit-after-first-node.png');

    // Send second node (spread apart from first)
    const secondNodeDelta = createSingleNodeDelta('node-2.md', 'Second Node', 400, 300);
    await sendGraphDelta(page, secondNodeDelta);

    nodeCount = await getNodeCount(page);
    expect(nodeCount).toBe(2);

    // Wait for fit animation to complete
    await page.waitForTimeout(500);

    // Take screenshot after second node
    await page.screenshot({
      path: 'e2e-tests/screenshots/initial-fit-after-second-node.png',
      fullPage: false
    });

    // Log viewport info
    viewportInfo = await page.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return null;
      return {
        zoom: cy.zoom(),
        pan: cy.pan(),
        nodeCount: cy.nodes().length
      };
    });
    console.log('Viewport after second node:', JSON.stringify(viewportInfo, null, 2));
    console.log('✓ Screenshot saved to e2e-tests/screenshots/initial-fit-after-second-node.png');
  });
});
