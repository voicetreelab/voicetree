/**
 * E2E tests for the "No nodes in view" toast notification.
 *
 * Validates the observable outcome of viewport visibility checks
 * (backed by R-tree spatial index) across tricky viewport scenarios:
 * toast show/hide, viewport edge boundaries, rapid panning with debounce,
 * fit-to-graph button, empty graph guard, and dismiss cooldown.
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  createTestGraphDelta,
  sendGraphDelta,
  waitForCytoscapeReady,
  getNodeCount,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import {
  DEBOUNCE_WAIT,
  setupGraphAndFit,
  setupEmptyGraph,
  panBy,
  isToastVisible,
  computeEdgeBoundary,
  forceSpatialIndexRebuild,
} from './toast-test-helpers';

// Console capture fixture (reused pattern from hotkeys-navigation.spec.ts)
const test = base.extend<{ consoleCapture: { consoleLogs: string[]; pageErrors: string[]; testLogs: string[] } }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const testLogs: string[] = [];

    page.on('console', msg => { consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`); });
    page.on('pageerror', error => { pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`); });

    const originalLog = console.log;
    console.log = (...args: unknown[]) => { testLogs.push(args.map(arg => String(arg)).join(' ')); };

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


test.describe('No Visible Nodes Toast', () => {

  test('toast show/hide + viewport edge boundary', async ({ page, consoleCapture: _cc }) => {
    await setupGraphAndFit(page);

    // 1a. After fit → no toast
    expect(await isToastVisible(page)).toBe(false);

    // 1b. Pan far away → toast appears
    await panBy(page, -50000, -50000);
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(true);

    // 1c. Fit back → toast auto-hides
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.fit();
    });
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(false);

    // 1d. Edge boundary: force R-tree rebuild, then test precise boundary
    await page.waitForTimeout(500);
    await forceSpatialIndexRebuild(page);

    const edge = await computeEdgeBoundary(page);

    // "Barely inside": viewport left = innerRightEdge - 10 (node's body overlaps by 10px)
    await page.evaluate(({ innerRightEdge, panY }) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.zoom(1);
      cy.pan({ x: -(innerRightEdge - 10), y: panY });
    }, { innerRightEdge: edge.innerRightEdge, panY: edge.panYCenter });
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(false);

    // "Barely outside": viewport left = outerRightEdge + 10 (past label extent)
    await page.evaluate(({ outerRightEdge, panY }) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.pan({ x: -(outerRightEdge + 10), y: panY });
    }, { outerRightEdge: edge.outerRightEdge, panY: edge.panYCenter });
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(true);
  });

  test('rapid pan between distant clusters (debounce prevents mid-flight flicker)', async ({ page, consoleCapture: _cc }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create two clusters 30,000px apart
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.add([
        { group: 'nodes' as const, data: { id: 'cluster-b-1.md', label: 'B1', fileBasename: 'B1' }, position: { x: 30000, y: 100 } },
        { group: 'nodes' as const, data: { id: 'cluster-b-2.md', label: 'B2', fileBasename: 'B2' }, position: { x: 30200, y: 200 } }
      ]);
    });

    // Capture viewport state for each cluster (fit once, record, reuse via direct pan)
    const vp = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      cy.fit(cy.nodes().filter((n: cytoscape.NodeSingular) => n.id().startsWith('test-')));
      const a = { pan: { ...cy.pan() }, zoom: cy.zoom() };

      cy.fit(cy.nodes().filter((n: cytoscape.NodeSingular) => n.id().startsWith('cluster-b')));
      const b = { pan: { ...cy.pan() }, zoom: cy.zoom() };

      cy.zoom(a.zoom);
      cy.pan(a.pan);
      return { a, b };
    });
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(false);

    // Rapidly pan 5x with 50ms intervals (faster than 200ms debounce)
    for (let i = 0; i < 5; i++) {
      await page.evaluate((v) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        cy.zoom(v.zoom); cy.pan(v.pan);
      }, vp.b);
      await page.waitForTimeout(50);

      await page.evaluate((v) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        cy.zoom(v.zoom); cy.pan(v.pan);
      }, vp.a);
      await page.waitForTimeout(50);
    }

    // End on cluster A → debounce settles → no toast
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(false);

    // Pan to empty midpoint → toast appears
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.zoom(1);
      cy.pan({ x: -15000, y: -150 });
    });
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(true);
  });

  test('"Fit to Graph" button restores viewport', async ({ page, consoleCapture: _cc }) => {
    await setupGraphAndFit(page);

    await panBy(page, -50000, -50000);
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(true);

    await page.locator('#fit-to-graph-btn').click();
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(false);

    // Verify nodes are back in viewport via bounding box check
    const nodesInView = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const extent = cy.extent();
      const nodes = cy.nodes().filter((n: cytoscape.NodeSingular) => !n.data('isShadowNode'));
      let count = 0;
      nodes.forEach((node: cytoscape.NodeSingular) => {
        const bb = node.boundingBox();
        if (!(bb.x2 < extent.x1 || bb.x1 > extent.x2 || bb.y2 < extent.y1 || bb.y1 > extent.y2)) count++;
      });
      return count;
    });
    expect(nodesInView).toBeGreaterThan(0);
  });

  test('empty graph never shows toast', async ({ page, consoleCapture: _cc }) => {
    await setupEmptyGraph(page);
    expect(await getNodeCount(page)).toBe(0);

    // Pan to multiple positions + extreme zoom — toast should never appear
    for (const pos of [{ x: 0, y: 0 }, { x: -10000, y: -10000 }, { x: 50000, y: 50000 }]) {
      await page.evaluate((p) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        cy.pan(p);
      }, pos);
      await page.waitForTimeout(DEBOUNCE_WAIT);
      expect(await isToastVisible(page)).toBe(false);
    }

    for (const zoom of [0.01, 5, 20]) {
      await page.evaluate((z) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        cy.zoom(z);
      }, zoom);
      await page.waitForTimeout(DEBOUNCE_WAIT);
      expect(await isToastVisible(page)).toBe(false);
    }
  });

  test('dismiss cooldown prevents re-show for 5 seconds', async ({ page, consoleCapture: _cc }) => {
    await setupGraphAndFit(page);

    // Pan away → toast → dismiss
    await panBy(page, -50000, -50000);
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(true);

    await page.locator('#dismiss-toast-btn').click();
    await page.waitForTimeout(100);
    expect(await isToastVisible(page)).toBe(false);

    // Pan within 5s cooldown → toast stays hidden
    await panBy(page, -1000, -1000);
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(false);

    await panBy(page, -2000, -2000);
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(false);

    // Wait for cooldown to expire, then pan → toast reappears
    await page.waitForTimeout(4500);
    await panBy(page, -3000, -3000);
    await page.waitForTimeout(DEBOUNCE_WAIT);
    expect(await isToastVisible(page)).toBe(true);
  });
});
