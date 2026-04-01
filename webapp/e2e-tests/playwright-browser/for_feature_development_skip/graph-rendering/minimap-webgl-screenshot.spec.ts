/**
 * Browser E2E test: Verify the cytoscape-navigator minimap renders correctly
 *
 * Note: In headless Chrome, the navigator thumbnail may not populate because
 * cy.png() (which uses canvas.toDataURL) can hang. The Electron test is the
 * reliable way to verify thumbnail rendering with WebGL. This test validates
 * minimap visibility and structure.
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  sendGraphDelta,
  waitForCytoscapeReady,
  getNodeCount,
  createTestGraphDelta,
} from '@e2e/playwright-browser/graph-delta-test-utils';

test.describe('Minimap WebGL Rendering', () => {
  test('minimap should be visible with graph thumbnail after nodes load', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Minimap requires 2+ nodes to become visible
    const testDelta = createTestGraphDelta();
    await sendGraphDelta(page, testDelta);

    const nodeCount = await getNodeCount(page);
    expect(nodeCount).toBeGreaterThanOrEqual(2);

    // Wait for layout animation to settle
    await page.waitForTimeout(600);

    // Verify the minimap container is visible
    const navigatorEl = page.locator('.cytoscape-navigator');
    await expect(navigatorEl).toBeVisible({ timeout: 3000 });

    // Verify structural elements exist: img for thumbnail, view rectangle
    const hasStructure = await page.evaluate(() => {
      const nav = document.querySelector('.cytoscape-navigator');
      const img = nav?.querySelector('img');
      const view = nav?.querySelector('.cytoscape-navigatorView');
      return { hasImg: !!img, hasView: !!view };
    });
    expect(hasStructure.hasImg).toBe(true);
    expect(hasStructure.hasView).toBe(true);

    // Take screenshots for visual reference
    await navigatorEl.screenshot({
      path: 'e2e-tests/screenshots/minimap-webgl-thumbnail.png',
    });
    await page.screenshot({
      path: 'e2e-tests/screenshots/minimap-webgl-full-page.png',
      fullPage: false,
    });
  });

  test('minimap should still be visible and structured after pan/zoom (thumbnailEventFramerate=0)', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    const testDelta = createTestGraphDelta();
    await sendGraphDelta(page, testDelta);

    const nodeCount = await getNodeCount(page);
    expect(nodeCount).toBeGreaterThanOrEqual(2);

    await page.waitForTimeout(600);

    // Confirm minimap is visible before pan
    const navigatorEl = page.locator('.cytoscape-navigator');
    await expect(navigatorEl).toBeVisible({ timeout: 3000 });

    // Simulate pan/zoom via the cytoscape instance — no thumbnail should fire during these
    await page.evaluate(() => {
      const cy = (window as unknown as { cytoscapeInstance?: { pan: (pos: { x: number; y: number }) => void; zoom: (level: number) => void } }).cytoscapeInstance;
      if (!cy) return;
      cy.pan({ x: 50, y: 50 });
      cy.zoom(1.2);
      cy.pan({ x: 0, y: 0 });
      cy.zoom(1.0);
    });

    // Wait for rerenderDelay (100ms) + buffer so thumbnail regenerates on idle
    await page.waitForTimeout(300);

    // Minimap must still be visible and structurally intact after idle regeneration
    await expect(navigatorEl).toBeVisible({ timeout: 2000 });
    const hasStructure = await page.evaluate(() => {
      const nav = document.querySelector('.cytoscape-navigator');
      return {
        hasImg: !!nav?.querySelector('img'),
        hasView: !!nav?.querySelector('.cytoscape-navigatorView'),
      };
    });
    expect(hasStructure.hasImg).toBe(true);
    expect(hasStructure.hasView).toBe(true);
  });

  test('minimap should be hidden when only 1 node exists', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    await sendGraphDelta(page, [{
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: 'single-node.md',
        contentWithoutYamlOrLinks: '# Single Node\nOnly one node in the graph.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 200, y: 200 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false,
        },
      },
      previousNode: { _tag: 'None' } as const,
    }]);

    const nodeCount = await getNodeCount(page);
    expect(nodeCount).toBe(1);

    await page.waitForTimeout(300);

    const navigatorEl = page.locator('.cytoscape-navigator');
    await expect(navigatorEl).toBeHidden();
  });
});
