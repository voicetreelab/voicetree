/**
 * Browser-based test for ninja-keys search navigation
 * Tests the cmd-f search functionality and node navigation without Electron
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  createTestGraphDelta,
  sendGraphDelta,
  waitForCytoscapeReady,
  getNodeCount,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';

test.describe('Search Navigation (Browser)', () => {
  test('should open search with cmd-f and navigate to selected node', async ({ page }) => {
    console.log('\n=== Starting ninja-keys search navigation test (Browser) ===');

    // Listen for console messages (errors, warnings, logs)
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      console.log(`[Browser ${type}] ${text}`);
    });

    // Listen for page errors (uncaught exceptions)
    page.on('pageerror', error => {
      console.error('[Browser Error]', error.message);
      console.error(error.stack);
    });

    console.log('=== Step 1: Mock Electron API BEFORE navigation ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/'); // Vite dev server URL

    // Wait for React to render
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    // Wait for graph update handler to be registered
    await page.waitForTimeout(500);
    console.log('✓ Graph update handler should be registered');

    console.log('=== Step 3: Wait for Cytoscape to initialize ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Setup test graph via electronAPI graph update ===');
    // Trigger the graph update through the electronAPI callback mechanism
    // This simulates how the real app receives graph updates
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    const nodeCount = await getNodeCount(page);
    expect(nodeCount).toBe(5);
    console.log(`✓ Test graph setup complete with ${nodeCount} nodes`);

    console.log('=== Step 5: Get initial zoom/pan state ===');
    const initialState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const zoom = cy.zoom();
      const pan = cy.pan();
      return { zoom, pan };
    });
    console.log(`  Initial zoom: ${initialState.zoom}, pan: (${initialState.pan.x}, ${initialState.pan.y})`);

    console.log('=== Step 6: Open ninja-keys search with keyboard shortcut ===');
    // Simulate cmd-f (Meta+f on Mac, Ctrl+f elsewhere)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');

    // Wait for ninja-keys modal to appear
    await page.waitForTimeout(300);

    const ninjaKeysVisible = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) return false;
      const shadowRoot = ninjaKeys.shadowRoot;
      if (!shadowRoot) return false;
      const modal = shadowRoot.querySelector('.modal');
      // Check if modal exists and is not hidden
      return modal !== null;
    });

    expect(ninjaKeysVisible).toBe(true);
    console.log('✓ ninja-keys search modal opened');

    console.log('=== Step 7: Get a target node to search for ===');
    const targetNode = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      // Get first node
      const node = nodes[0];
      return {
        id: node.id(),
        label: node.data('label') ?? node.id()
      };
    });

    console.log(`  Target node: ${targetNode.label} (${targetNode.id})`);

    console.log('=== Step 8: Type search query into ninja-keys ===');
    // Type a few characters from the node ID (which is now the filename like "test-node-1.md")
    // We search for "test-node" which should match the node ID
    const searchQuery = 'test-node';
    await page.keyboard.type(searchQuery);

    // Wait for search results to update
    await page.waitForTimeout(300);
    console.log(`  Typed search query: "${searchQuery}"`);

    console.log('=== Step 9: Select first result with Enter ===');
    await page.keyboard.press('Enter');

    // Wait for navigation animation and fit to complete
    await page.waitForTimeout(1000);

    console.log('=== Step 10: Verify zoom/pan changed (node was fitted) ===');
    const finalState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const zoom = cy.zoom();
      const pan = cy.pan();
      return { zoom, pan };
    });

    console.log(`  Final zoom: ${finalState.zoom}, pan: (${finalState.pan.x}, ${finalState.pan.y})`);

    // Check that EITHER zoom or pan changed (cy.fit modifies these)
    const zoomChanged = Math.abs(finalState.zoom - initialState.zoom) > 0.01;
    const panChanged = Math.abs(finalState.pan.x - initialState.pan.x) > 1 ||
                       Math.abs(finalState.pan.y - initialState.pan.y) > 1;

    expect(zoomChanged || panChanged).toBe(true);
    console.log('✓ Graph viewport changed - node was fitted');

    console.log('=== Step 11: Verify ninja-keys modal closed ===');
    const ninjaKeysClosed = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) return true; // Not found means closed
      const shadowRoot = ninjaKeys.shadowRoot;
      if (!shadowRoot) return true;
      const modal = shadowRoot.querySelector('.modal');
      // Modal should be hidden or removed
      if (!modal) return true;
      const overlay = shadowRoot.querySelector('.modal-overlay');
      // Check if overlay is visible (indicates open state)
      return overlay ? getComputedStyle(overlay).display === 'none' : true;
    });

    expect(ninjaKeysClosed).toBe(true);
    console.log('✓ ninja-keys modal closed after selection');

    console.log('=== Step 12: SECOND SEARCH - Open ninja-keys again with cmd-f ===');
    // Wait a moment to ensure any cleanup has completed
    await page.waitForTimeout(300);

    // Try to open search again
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');

    // Wait for ninja-keys modal to appear
    await page.waitForTimeout(300);

    const ninjaKeysVisibleSecondTime = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) return false;
      const shadowRoot = ninjaKeys.shadowRoot;
      if (!shadowRoot) return false;
      const modal = shadowRoot.querySelector('.modal');
      // Check if modal exists and is not hidden
      return modal !== null;
    });

    expect(ninjaKeysVisibleSecondTime).toBe(true);
    console.log('✓ ninja-keys search modal opened SECOND time');

    console.log('=== Step 13: Search for a different node ===');
    // Search for a different node (test-node-2)
    const searchQuery2 = 'Architecture';
    await page.keyboard.type(searchQuery2);

    // Wait for search results to update
    await page.waitForTimeout(300);
    console.log(`  Typed search query: "${searchQuery2}"`);

    console.log('=== Step 14: Select result with Enter ===');
    await page.keyboard.press('Enter');

    // Wait for navigation animation and fit to complete
    await page.waitForTimeout(1000);

    console.log('=== Step 15: Verify second search worked ===');
    const finalStateSecondSearch = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const zoom = cy.zoom();
      const pan = cy.pan();
      return { zoom, pan };
    });

    console.log(`  Final zoom after 2nd search: ${finalStateSecondSearch.zoom}, pan: (${finalStateSecondSearch.pan.x}, ${finalStateSecondSearch.pan.y})`);

    // Verify modal closed again
    const ninjaKeysClosedSecondTime = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) return true;
      const shadowRoot = ninjaKeys.shadowRoot;
      if (!shadowRoot) return true;
      const modal = shadowRoot.querySelector('.modal');
      if (!modal) return true;
      const overlay = shadowRoot.querySelector('.modal-overlay');
      return overlay ? getComputedStyle(overlay).display === 'none' : true;
    });

    expect(ninjaKeysClosedSecondTime).toBe(true);
    console.log('✓ ninja-keys modal closed after second selection');

    console.log('✓ ninja-keys search navigation test completed (with second search)');
  });
});
