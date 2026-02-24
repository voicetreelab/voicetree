/**
 * Helper functions for the "No visible nodes" toast e2e tests.
 *
 * Pure viewport manipulation helpers + graph setup with Cola layout animation
 * wait and R-tree spatial index rebuild.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  createTestGraphDelta,
  sendGraphDelta,
  waitForCytoscapeReady,
  getNodeCount,
  type ExtendedWindow,
} from '@e2e/playwright-browser/graph-delta-test-utils';

// Re-export ExtendedWindow for use in spec files' page.evaluate() calls
export type { ExtendedWindow };

/** 200ms debounce + 100ms safety margin */
export const DEBOUNCE_WAIT = 300;

/**
 * Set up app with 5-node test graph and fit to view.
 *
 * Includes a wait for Cola layout animation (~400ms) + forced spatial index
 * rebuild via layoutstop emission. Without this, the R-tree may have stale
 * positions from before the layout animation completed.
 */
export async function setupGraphAndFit(page: Page): Promise<void> {
  await setupMockElectronAPI(page);
  await page.goto('/');
  await selectMockProject(page);
  await page.waitForSelector('#root', { timeout: 5000 });
  await page.waitForTimeout(50);
  await waitForCytoscapeReady(page);

  const graphDelta = createTestGraphDelta();
  await sendGraphDelta(page, graphDelta);

  const nodeCount = await getNodeCount(page);
  expect(nodeCount).toBe(5);

  // Wait for Cola layout animation (400ms + safety) and any layout trigger debounce.
  // Then force R-tree rebuild twice: once to pick up post-animation positions,
  // and again after fit() to ensure the spatial index matches the final viewport state.
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    cy.emit('layoutstop'); // Force spatial index rebuild with final positions
    cy.fit();
    cy.emit('layoutstop'); // Rebuild again after fit (positions may shift with padding)
  });
  await page.waitForTimeout(DEBOUNCE_WAIT);
}

/**
 * Set up app with Cytoscape ready but NO graph data (0 nodes).
 */
export async function setupEmptyGraph(page: Page): Promise<void> {
  await setupMockElectronAPI(page);
  await page.goto('/');
  await selectMockProject(page);
  await page.waitForSelector('#root', { timeout: 5000 });
  await page.waitForTimeout(50);
  await waitForCytoscapeReady(page);
}

/** Pan the viewport by a given offset in model coordinates. */
export async function panBy(page: Page, dx: number, dy: number): Promise<void> {
  await page.evaluate(({ dx, dy }) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const pan = cy.pan();
    cy.pan({ x: pan.x + dx, y: pan.y + dy });
  }, { dx, dy });
}

/** Check if the "No nodes in view" toast is present in the DOM. */
export async function isToastVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => document.getElementById('no-visible-nodes-toast') !== null);
}

/**
 * Compute the viewport edge boundary data for the rightmost node.
 *
 * Returns both the R-tree AABB right edge and the boundingBox right edge,
 * plus a Y-center value for keeping the node vertically in view.
 * The caller should use innerRightEdge for "barely inside" and
 * outerRightEdge for "barely outside" to be robust against either code path.
 */
export async function computeEdgeBoundary(page: Page): Promise<{
  innerRightEdge: number;
  outerRightEdge: number;
  panYCenter: number;
  nodeId: string;
}> {
  return page.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const nodes = cy.nodes().filter((n: cytoscape.NodeSingular) => !n.data('isShadowNode'));
    let rightmost = nodes[0];
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i].boundingBox().x2 > rightmost.boundingBox().x2) {
        rightmost = nodes[i];
      }
    }

    const bb = rightmost.boundingBox();
    const bbRightEdge = bb.x2;
    const rtreeRightEdge = rightmost.position().x + rightmost.outerWidth() / 2;

    const innerRightEdge = Math.min(bbRightEdge, rtreeRightEdge);
    const outerRightEdge = Math.max(bbRightEdge, rtreeRightEdge);

    const nodeCenterY = (bb.y1 + bb.y2) / 2;
    const containerHeight = cy.container()?.clientHeight ?? 600;
    const panYCenter = containerHeight / 2 - nodeCenterY;

    return { innerRightEdge, outerRightEdge, panYCenter, nodeId: rightmost.id() };
  });
}

/**
 * Force spatial index rebuild by emitting layoutstop.
 * Call after Cola animation has settled (~500ms after sendGraphDelta).
 */
export async function forceSpatialIndexRebuild(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    cy.emit('layoutstop');
  });
  await page.waitForTimeout(100);
}
